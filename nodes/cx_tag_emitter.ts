import {Node, NodeAPI, NodeDef} from "node-red";
import {EventEmitter} from "events";

interface ITagInNodeConfig extends NodeDef {
    storage: string, // storage config node ID
    path: string;
    name: string,
    isBatch: boolean,
    tagName?: string,
    dType?: string,
    desc?: string,
    deadband?: string
}

interface IValueEmitterConfig extends NodeDef {
    storage: string, // storage config node ID
    path: string;
    addedTagName: string;
    name: string,
    tagName: string | number,
    emitOnStart: boolean,
    isToEmitAllChanges: boolean,
}

interface IStorageManagerConfig extends NodeDef {
    name: string,
    storeName: string,
    paths: {[key: string]: string[]}
}

interface ITagStorage {
    [tagName: string]: Tag,
}

interface ITagStoragePath {
    [path: string]: ITagStorage,
}

interface ITagNameValueObject {
    [tagName: string]: any
}


interface IStorageManagerNode extends Node<{}> {
    tagStorage?: TagStorage
}



const TAGS_STORAGE = "_TAGS_";
const ROOT_STORAGE_PATH = "[root]";
class TagStorage {
    storage: ITagStoragePath = {
        [ROOT_STORAGE_PATH]: {}
    }

    get name() {
        return this.storeName || "";
    }

    static getStoragesByGlobalContext(node: Node, storageName: string): ITagStoragePath {
        const _storeName = storageName === "default" ? undefined : storageName;
        const storage = node
            .context()
            .global
            .get(TAGS_STORAGE, _storeName) as ITagStoragePath | undefined;

        return storage || {}
    }

    constructor(node: Node, private readonly storeName?: string) {
        const _storeName = this.storeName === "default" ? undefined : this.storeName;
        const storage = node
            .context()
            .global
            .get(TAGS_STORAGE, _storeName) as ITagStoragePath | undefined;

        if (storage) {
            this.storage = storage;
        } else {
            node
                .context()
                .global
                .set(TAGS_STORAGE, this.storage, _storeName)
        }
    }

    setStorage(path: string): ITagStorage {
        if (!this.storage[path]) this.storage[path] = {};
        return this.storage[path];
    }

    getStorage(path: string): ITagStorage | undefined {
        path = path || ROOT_STORAGE_PATH;
        return this.storage[path];
    }

    getTag(tagName: string, path: string): Tag | undefined {
        path = path || ROOT_STORAGE_PATH;
        if (!this.storage[path]) return;

        return this.storage[path][tagName];
    }

    setTag(tag: Tag, path: string): Tag {
        path = path || ROOT_STORAGE_PATH;
        this.storage[path][tag.name] = tag;
        return tag;
    }

    getNameValueObject(tagIdList: string[], path: string): ITagNameValueObject {
        path = path || ROOT_STORAGE_PATH;
        const out: ITagNameValueObject = {};
        const storage = this.storage[path];
        if (!storage) return out;

        for (const tagId of tagIdList) {
            const tag = storage[tagId];
            if (!tag) continue;
            out[tag.name] = tag.value;
        }
        return out
    }

    deleteTag(tagId: string, path: string): string | undefined {
        path = path || ROOT_STORAGE_PATH;
        const storage = this.storage[path];
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

module.exports = function(RED: NodeAPI) {

    const ALL_CHANGES_CHANNEL = "__ALL_CHANGES__";
    const eventEmitter =  new EventEmitter();

    let lastCall_ms = 0;
    let at10msCounter = 0;
    let tagListenerCounter: {[tag: string]: number} = {};
    const redContextStorage = RED.settings.get("contextStorage");
    const storages = redContextStorage ? Object.keys(redContextStorage) : [];
    if (!storages.includes("default"))
        storages.unshift("default");

    RED.httpAdmin.get('/__cx_tag_emitter/get_storages', (req, res) => {
        res.json(storages).end();
    })


    RED.httpAdmin.get("/__cx_tag_emitter/get_paths", (req, res) => {
        const configNodeId = req.query["config_node_id"] as string;
        const storageName = req.query["storage_name"] as string;
        const isStats = req.query["stats"] === "true";

        const configNode: IStorageManagerNode | undefined = RED.nodes.getNode(configNodeId);

        if (!configNodeId || !configNode || !configNode.tagStorage) {
            if (isDebug) console.log("Something wrong, there is no config node:", configNode);
            return res.json([ROOT_STORAGE_PATH]).end();
        }

        const storage = (storageName) ?
            TagStorage.getStoragesByGlobalContext(configNode, storageName) :
            configNode.tagStorage.storage;

        const paths = Object.keys(storage);

        paths.sort();
        if (!isStats)
            return res.json(paths).end();

        const pathsAndStats = paths.map(path => {
            return [path, {
                tagQty: Object.keys(storage[path]).length
            }]
        })
        res.json(pathsAndStats).end();
    })


    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', (req, res) => {
        const configNodeId = req.query["config_node_id"] as string;
        const parentPath = req.query["parent_path"] as string;

        if (isDebug) console.log("GET get_variables:", {configNodeId, parentPath});

        const configNode: IStorageManagerNode | undefined = RED.nodes.getNode(configNodeId);

        if (!configNodeId || !parentPath || !configNode || !configNode.tagStorage) {
            if (isDebug) console.log("Something wrong, there is no config node:", configNode);
            return res.json([]).end();
        }

        const currentTags = configNode.tagStorage.getStorage(parentPath);
        if (!currentTags)
            return res.json([]).end();

        const tagNames: string[] = Object.keys(currentTags);
        tagNames.sort();

        const values: {[tagName: string]: any} = {};
        const descriptions: {[tagName: string]: string | undefined} = {};
        for (const tag of tagNames) {
            if (!currentTags[tag]) continue;

            values[tag] = currentTags[tag].value;
            if (currentTags[tag].desc) descriptions[tag] = currentTags[tag].desc;
        }

        res.json([tagNames, values, descriptions]).end();
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


    function StorageConfig(config: IStorageManagerConfig) {
        RED.nodes.createNode(this, config);
        const node: IStorageManagerNode = this;

        node.tagStorage = new TagStorage(node, config.storeName);
    }



    function ValueEmitter(config: IValueEmitterConfig) {
        // @ts-ignore
        RED.nodes.createNode(this, config);
        const node: Node = this;

        // get storage node ID from the config
        const configNodeId = config.storage;
        const configNode: IStorageManagerNode = RED.nodes.getNode(configNodeId);
        if (!configNode || !configNode.tagStorage)
            return node.error("Select Storage Node and its context name");

        if (typeof config.path !== "string" || !config.path)
            return node.error("Tags path must be defined");

        const tagStorage = configNode.tagStorage;

        // fixing MaxListenersExceededWarning
        // Looking after RED.events max listeners: adding max listeners number one by one
        if (config.emitOnStart) {
            const listenerCounts = RED.events.getMaxListeners() + 1;
            RED.events.setMaxListeners(listenerCounts);
        }

        node.on("input", emitCurrentTags);
        const parentPath = config.path;
        let isError = false;

        if (config.isToEmitAllChanges) {
            //
            // ============= This is if ALL tag changes emitted ==============
            //
            eventEmitter.on(parentPath + "/" + ALL_CHANGES_CHANNEL, handleAnyTagChange);
            if (config.emitOnStart)
                RED.events.on("flows:started", emitOnStart)


            node.on("close", () => {
                eventEmitter.removeListener(parentPath + "/" + ALL_CHANGES_CHANNEL, handleAnyTagChange)
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

        // don't bother going further if no tags selected
        if (!tagNames.length) return;


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
                const currentTags = tagStorage.getStorage(parentPath);
                if (!currentTags) {
                    handleError("No storage");
                    return node.error(`Storage at path "${parentPath}" doesn't exist`);
                } else
                    handleError();

                handleAnyTagChange(Object.keys(currentTags));

            } else {
                tagNames.forEach(handleSomeTagChanges);
            }
        }

        // FROM: eventEmitter.emit(path + "/" + changedTag, changedTag);
        function handleSomeTagChanges(tagName: string) {
            const tag = tagStorage.getTag(tagName, parentPath);
            if (!tag) return;

            const isOnlyOneTagToEmit = tagNames.length === 1 && !addedTagNames.length;

            if (isOnlyOneTagToEmit) {
                node.send(buildMessage(tagName, tag.value, {prevValue: tag.prevValue}))
                // node.send({topic: tagName, payload: tag.value, prevValue: tag.prevValue, path: parentPath});
                return;
            }


            // When config.tagName has multiple tags (eg. STRING_TAG_1, NUMBER_TAG_1,BOOLEAN_TAG_1)
            // the node EMITS multiple times (eg. 3 times)
            // Solution is to send the BATCH in this JS Loop, prevent from sending and let in the next JS loop
            if (isBatchSent) return;

            const allTagNames = tagNames.concat(addedTagNames);
            const batchObject = tagStorage.getNameValueObject(allTagNames, parentPath);
            node.send(buildMessage("__some", batchObject))
            isBatchSent = true;

            // remove isBatchSent flag in the next JS loop
            setTimeout(() => isBatchSent = false, 0)
        }

        function handleAnyTagChange(idListOfChangedTagValues: string[]) {
            const payload: {[key: string]: any} = tagStorage.getNameValueObject(idListOfChangedTagValues, parentPath);

            if (!Object.keys(payload).length)
                return handleError("Nothing to emit");
            else handleError();

            node.send(buildMessage("__all", payload))
        }

        function buildMessage(topic: string, payload: any, additionalProps?: {[key: string]: any}) {
            additionalProps = additionalProps || {};
            return {
                ...additionalProps,
                topic, payload,
                path: parentPath,
                storage: tagStorage.name
            }
        }

        function handleError(text?: string) {
            if (text) {
                isError = true;
                return node.status({fill: "red", shape: "dot", text})
            }

            if (isError) {
                isError = false;
                node.status("");
            }

        }
    }




    function TagsIn(config: ITagInNodeConfig) {

        // @ts-ignore
        RED.nodes.createNode(this, config);
        const node = this;

        // get storage node ID from the config
        const configNodeId = config.storage;
        const configNode: IStorageManagerNode = RED.nodes.getNode(configNodeId);
        if (!configNode || !configNode.tagStorage)
            return node.error("Config 'tag-storage' node must be selected");

        if (typeof config.path !== "string" || !config.path)
            return node.error("Tags path must be defined");

        const parentPath = config.path;
        const tagStorage = configNode.tagStorage;

        node.on("input", (msg: any) => {

            const isTooOften = checkIfTooOften();
            lastCall_ms = Date.now();
            if (isTooOften) {
                node.error("Emit cancelled, the node called TOO often!");
                return;
            }

            const currentTags: ITagStorage = tagStorage.setStorage(parentPath);

            if (msg.deleteTag) {
                const deletedTagId = tagStorage.deleteTag(msg.topic, parentPath);
                if (deletedTagId) {
                    node.warn(`Tag '${parentPath}/${msg.topic}' DELETED`);
                } else {
                    node.warn(`Tag '${parentPath}/${msg.topic}' NOT FOUND`);
                }
                return;
            }

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

            }

            if (!namesOfChangedTags.length) return;

            // send MSG as it would be emitted from a TagEmitter node
            const newMsg: {[key: string]: any} = {};

            if (config.isBatch) {
                newMsg.topic = msg.topic;
                newMsg.payload = tagStorage.getNameValueObject(namesOfChangedTags, parentPath);
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
            eventEmitter.emit(parentPath + "/" + ALL_CHANGES_CHANNEL, namesOfChangedTags);
        });



        // returns Tag if changed
        function setNewTagValueIfChanged(tagId: string, newValue: any, path: string, isToRestore?: boolean): Tag | undefined {
            if (typeof newValue === "function") return;

            const tagFromStore = tagStorage.getTag(tagId, path);
            const nodeId = isToRestore ? "" : node.id;
            const tag = tagFromStore ? tagFromStore : new Tag(tagId, nodeId);

            if (!tagFromStore) tagStorage.setTag(tag, path);

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

    RED.nodes.registerType("tag-storage", StorageConfig);
    RED.nodes.registerType("value_emitter", ValueEmitter);
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
