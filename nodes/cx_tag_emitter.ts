import {NodeRedApp} from "node-red";
import {EventEmitter} from "events";

interface ITagInNodeConfig {
    path: string;
    name: string,
    isBatch: boolean,
    tagName?: string,
    dType?: string,
    desc?: string,
    deadband?: string
}

interface IValueEmitterConfig {
    path: string;
    addedTagName: string;
    name: string,
    tagName: string | number,
    emitOnStart: boolean,
    isToEmitAllChanges: boolean,
}


interface ITagStorage {
    [tagName: string]: Tag,
}

interface ITagStoragePath {
    [path: string]: ITagStorage,
    root: ITagStorage,
}

interface ITagNameValueObject {
    [tagName: string]: any
}

const ALL_TAGS_STORAGE = "__ALL_TAGS__";
interface IGlobalStorage {
    get: (storageId: string) => ITagStoragePath,
    set: (storageId: string, obj: any) => void,
}


class TagStorage {
    static globalContext: IGlobalStorage;
    static storage: ITagStoragePath = {
        root: {}
    };

    static setGlobalStorage(global: IGlobalStorage) {
        if (TagStorage.globalContext) return;

        TagStorage.globalContext = global;
        TagStorage.globalContext.set(ALL_TAGS_STORAGE, TagStorage.storage);
    }

    static getStorage(path: string): ITagStorage {
        if (path)
            return TagStorage.storage[path];

        return TagStorage.storage.root;
    }
    
    static getTag(tagName: string, path: string): Tag | undefined {
        if (path)
            return TagStorage.storage[path][tagName];
        return TagStorage.storage.root[tagName];
    }

    static setTag(tag: Tag, path: string): Tag {
        if (path)
            TagStorage.storage[path][tag.name] = tag;
        else
            TagStorage.storage.root[tag.name] = tag;

        return tag;
    }

    static getNameValueObject(tagIdList: string[], path: string): ITagNameValueObject {
        const out: ITagNameValueObject = {};
        const storage = path ? TagStorage.storage[path] : TagStorage.storage.root;
        if (!storage) return out;

        for (const tagId of tagIdList) {
            const tag = storage[tagId];
            if (!tag) continue;
            out[tag.name] = tag.value;
        }
        return out
    }

    static deleteTag(tagId: string, path?: string): string | undefined {
        const storage = path ? TagStorage.storage[path] : TagStorage.storage.root;
        const tag = storage ? storage[tagId] : null;

        if (tag && storage) {
            delete storage[tagId];
            return tagId
        }
    }

}


class Tag {
    get prevValue(): any {
        return this._prevValue;
    }
    get value(): any {
        return this._value;
    }

    // saves previous value
    set value(value: any) {
        this._prevValue = this._value;
        this._value = value;
    }

    get name(): any {
        return this._name;
    }

    desc?: string;
    db?: number; // deadband
    private _value: any = null;
    private _prevValue: any = null;

    constructor(private readonly _name: string, public sourceNodeId: string) {
        if (!_name) this._name = "unnamed";
    }
}


// TODO add deadband
// TODO attach tags.get() and tags.set() to RED object
// TODO add tag manager table in Tag Emitter node

const isDebug = !!process.env["TAG_EMITTER_NODE"];

module.exports = function (RED: NodeRedApp) {

    const ALL_CHANGES_CHANNEL = "__ALL_CHANGES__";
    const eventEmitter =  new EventEmitter();

    let lastCall_ms = 0;
    let at10msCounter = 0;
    let tagListenerCounter: {[tag: string]: number} = {};

    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', async (req, res) => {
        // const nodeId = req.query.node_id;
        // console.log(nodeId);

        // const node: Node = RED.nodes.getNode(nodeId);
        const parentPath = ""; //node.config;

        const currentTags = TagStorage.getStorage(parentPath);
        const tagList: string[] = [];
        for (const tag in currentTags) {
            const {desc, value} = currentTags[tag];
            const tagString = tag + "\t " + (
                typeof currentTags[tag].value === "object" ? JSON.stringify(value) : value
            ) + (desc ? ("\t\t" + desc) : "");

            tagList.push(tagString);
        }

        res.json(tagList).end();

    });


    RED.httpAdmin.post("/__cx_tag_emitter/emit_request/:id", (req,res) => {
        // @ts-ignore
        const node = RED.nodes.getNode(req.params.id);
        if (node != null) {
            try {
                node.receive();
                res.sendStatus(200);
            } catch(err) {
                res.sendStatus(500);
                node.error("Failed to Emit on button");
            }
        } else {
            res.sendStatus(404);
        }
    });





    function ValueEmitter(config: IValueEmitterConfig) {
        // @ts-ignore
        RED.nodes.createNode(this, config);
        const node = this;

        // fixing MaxListenersExceededWarning
        // Looking after RED.events max listeners: adding max listeners number one by one
        if (config.emitOnStart) {
            const listenerCounts = RED.events.getMaxListeners() + 1;
            RED.events.setMaxListeners(listenerCounts);
        }

        node.on("input", emitCurrentTags);
        const parentPath = config.path ? config.path : "";

        if (config.isToEmitAllChanges) {
            //
            // ============= This is if ALL tag changes emitted ==============
            //
            eventEmitter.on(ALL_CHANGES_CHANNEL, handleAnyTagChange);
            if (config.emitOnStart)
                RED.events.on("flows:started", emitOnStart)


            node.on("close", () => {
                eventEmitter.removeListener(ALL_CHANGES_CHANNEL, handleAnyTagChange)
            })

            return;
        }

        //
        // ============= This is if SOME or ONE tag changes emitted ==============
        //
        if (!config.tagName || typeof config.tagName !== "string") {
            node.error("Tag Name is not provided");
            return;
        }

        // split by comma, trim and remove empty results
        const tagNames = config.tagName.split(",").map(tag => tag.toString().trim()).filter(tag => !!tag);
        const addedTagNames = !config.addedTagName ? [] :
            config.addedTagName.split(",").map(tag => tag.toString().trim()).filter(tag => !!tag);

        if (!tagNames.length) return;

        // const currentTags = TagStorage.getStorage();
        // const currentTags: ITagStorage = node.context().global.get(ALL_TAGS_STORAGE) || {};
        // let batch: ITagNameValueObject | undefined;
        let isBatchSent = false;

        for (const tagName of tagNames) {
            const tagPath = parentPath + "/" + tagName;
            eventEmitter.on(tagPath, handleSomeTagChanges);

            // fixing MaxListenersExceededWarning
            if (!tagListenerCounter[tagName]) tagListenerCounter[tagName] = 0;
            tagListenerCounter[tagName]++;
        }

        const max = Math.max(...Object.values(tagListenerCounter));
        eventEmitter.setMaxListeners(max + 10);


        if (config.emitOnStart)
            RED.events.on("flows:started", emitOnStart);

        node.on("close", () => {
            for (const tagName of tagNames) {
                const tagPath = parentPath + "/" + tagName;
                eventEmitter.removeListener(tagPath, handleSomeTagChanges);
                tagListenerCounter[tagName]--;

                const listenerCount = eventEmitter.getMaxListeners();
                eventEmitter.setMaxListeners(listenerCount - 1);
            }
        })



        function emitOnStart() {
            emitCurrentTags();

            RED.events.removeListener("flows:started", emitOnStart);

            // Looking after RED.events max listeners: subtracting max listeners number one by one
            const listenerCounts = (RED.events.getMaxListeners() - 1) < 10 ? 10 : RED.events.getMaxListeners() - 1;
            RED.events.setMaxListeners(listenerCounts);
        }

        function emitCurrentTags() {
            if (config.isToEmitAllChanges) {

                const currentTags = TagStorage.getStorage(parentPath);
                // const currentTags: ITagStorage = node.context().global.get(ALL_TAGS_STORAGE) || {};

                // if (Object.keys(currentTags).length)
                handleAnyTagChange(Object.keys(currentTags));

            } else {
                tagNames.forEach(handleSomeTagChanges);
            }
        }

        // FROM: eventEmitter.emit(path + "/" + changedTag, changedTag);
        function handleSomeTagChanges(tagName: string) {
            const tag = TagStorage.getTag(tagName, parentPath);
            if (!tag) return;

            const isOnlyOneTagToEmit = tagNames.length === 1 && !addedTagNames.length;

            if (isOnlyOneTagToEmit) {
                node.send({ topic: tagName, payload: tag.value, prevValue: tag.prevValue });
                return;
            }


            // When config.tagName has multiple tags (eg. STRING_TAG_1, NUMBER_TAG_1,BOOLEAN_TAG_1)
            // the node EMITS multiple times (eg. 3 times)
            // Solution is to send the BATCH in this JS Loop, prevent from sending and let in the next JS loop
            if (isBatchSent) return;

            const allTagNames = tagNames.concat(addedTagNames);
            const batchObject = TagStorage.getNameValueObject(allTagNames, parentPath);
            node.send({topic: "__some", payload: batchObject});
            isBatchSent = true;

            // remove isBatchSent flag in the next JS loop
            setTimeout(() => isBatchSent = false, 0)
        }

        function handleAnyTagChange(idListOfChangedTagValues: string[]) {
            const payload: {[key: string]: any} = TagStorage.getNameValueObject(idListOfChangedTagValues, parentPath);

            node.send({ topic: "__all", payload})
        }
    }




    function TagsIn(config: ITagInNodeConfig) {

        // @ts-ignore
        RED.nodes.createNode(this, config);
        const node = this;

        if (!TagStorage.globalContext) {
            TagStorage.setGlobalStorage(node.context().global);
        }

        node.on("input", (msg: any) => {

            const isTooOften = checkIfTooOften();
            lastCall_ms = Date.now();
            if (isTooOften) {
                node.error("Emit cancelled, the node called TOO often!");
                return;
            }


            if (msg.deleteTag) {
                const deletedTagId = TagStorage.deleteTag(msg.topic);
                if (deletedTagId) {
                    node.warn(`Tag with name '${msg.topic}' DELETED`);
                } else {
                    node.warn(`Tag with name '${msg.topic}' NOT FOUND`);
                }
                return;
            }


            const parentPath = config.path ? config.path : "";
            const currentTags: ITagStorage = TagStorage.getStorage(parentPath);
            const namesOfChangedTags: string[] = [];

            if (config.isBatch) {

                // this is then BATCH Tag IN

                const newKeys = Object.keys(msg.payload || {});
                const newDescriptions = Object.keys(msg.desc || {});
                if (!newKeys.length && !newDescriptions.length) return;

                for (const key of newKeys) {
                    const tagName = key;
                    const newValue = msg.payload[key];
                    const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath, msg.restoreTags);
                    if (changedTag)
                        namesOfChangedTags.push(changedTag.name);
                }

                for (const tagName of newDescriptions) {
                    currentTags[tagName].desc = msg.desc[tagName].toString();
                }
            } else {

                // this is then SINGLE Tag IN

                const tagName = config.tagName || msg.topic;
                if (!tagName || typeof tagName !== "string") {
                    node.error("Invalid Tag Name: " + JSON.stringify(tagName));
                    return;
                }

                if (msg.payload == null) return;


                // prepare the tag
                const newValue = msg.payload;
                const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath);
                if (!changedTag) return;

                namesOfChangedTags.push(changedTag.name);

                // override config description with the incoming message .desc property
                if (typeof msg.desc === "string")
                    currentTags[tagName].desc = msg.desc;
                else if (config.desc)
                    currentTags[tagName].desc = config.desc;

                // add a deadband to the Tag Instance
                // const deadband = (typeof msg.deadband === "number") ? msg.deadband :
                //     (typeof config.db === "number") ? config.db : undefined;
                //
                // if (deadband != null) currentTags[tagName].db = deadband;

            }

            if (!namesOfChangedTags.length) return;

            // send MSG as it would be emitted from a TagEmitter node
            const newMsg: {[key: string]: any} = {};

            if (config.isBatch) {
                newMsg.topic = msg.topic;
                newMsg.payload = TagStorage.getNameValueObject(namesOfChangedTags, parentPath);
            } else {
                newMsg.topic = config.tagName || msg.topic;
                if (newMsg.topic) {
                    newMsg.payload = currentTags[newMsg.topic].value;
                    newMsg.prevValue = currentTags[newMsg.topic].prevValue;
                }
            }
            node.send(newMsg);


            for (const changedTag of namesOfChangedTags) {
                const tagPath = parentPath + "/" + changedTag;
                // function handleSomeTagChanges(tagName: string)
                eventEmitter.emit(tagPath, changedTag);
            }
            eventEmitter.emit(ALL_CHANGES_CHANNEL, namesOfChangedTags);
        });



        // returns Tag if changed
        function setNewTagValueIfChanged(tagId: string, newValue: any, path: string, isToRestore?: boolean): Tag | undefined {
            if (typeof newValue === "function") return;

            const tagFromStore = TagStorage.getTag(tagId, path);
            const nodeId = isToRestore ? "" : node.id;
            const tag = tagFromStore ? tagFromStore : new Tag(tagId, nodeId);

            if (!tagFromStore) TagStorage.setTag(tag, path);

            const currentValue = tag.value;
            if (isDifferent(newValue, currentValue)) {
                if (tag.sourceNodeId && tag.sourceNodeId !== node.id) {
                    node.warn(`Tag ${tagId} changed by two different sources. ` +
                        `From ${tag.sourceNodeId} to ${node.id}`);
                }

                // check if out of the deadband, if not return
                if (tag.db && typeof newValue === "number" && typeof currentValue === "number") {
                    if (newValue - currentValue < tag.db) return;
                }


                // save new and previous value to the Tag Instance
                tag.value = newValue;
                if (!isToRestore) tag.sourceNodeId = node.id;

                return tag
            }
        }
    }

    function checkIfTooOften() {

        if (Date.now() - lastCall_ms < 50) {
            at10msCounter++
        } else {
            at10msCounter = 0;
            return false;
        }

        const at10msFor100times = at10msCounter >= 100;
        // clamp counter if the function is kept called;
        if (at10msFor100times) at10msCounter = 100;
        return at10msFor100times;
    }

    // @ts-ignore
    RED.nodes.registerType("value_emitter", ValueEmitter);
    // @ts-ignore
    RED.nodes.registerType("tags_in", TagsIn);
}



function isDifferent(newValue: any, oldValue: any): boolean {
    if (oldValue == null && newValue != null) {
        return true;
    } else if (typeof newValue === "object" && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        return true;
    } else if (typeof newValue !== "object" && oldValue !== newValue) {
        return true;
    }
    return false;
}
