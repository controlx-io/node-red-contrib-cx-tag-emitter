import {Node, NodeRedApp} from "node-red";
import {EventEmitter} from "events";

interface ITagDefinition {
    tagName: string,
    dType?: string,
    desc?: string
}

interface IMonitorTagsConfig extends ITagDefinition {
    name: string,
    isBatch: boolean,
    tagName: string
}

interface IValueEmitterConfig {
    name: string,
    tagName: string | number,
    emitOnStart: boolean,
    isToEmitAllChanges: boolean,
}

interface IStorageTag extends ITagDefinition {
    sourceNodeId: string,
    value: number | string | boolean | object,
}

interface ITagStorage {
    [key: string]: IStorageTag
}

module.exports = function (RED: NodeRedApp) {

    const ALL_TAGS_STORAGE = "__ALL_TAGS__";
    const CHANGES_TOPIC = "__CHANGES__";

    const eventEmitter =  new EventEmitter();

    let lastCall_ms = 0;
    let at10msCounter = 0;

    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', async (req, res) => {
        // console.log(req.query);
        let node: Node | undefined;
        // @ts-ignore
        RED.nodes.eachNode((innerNode: Node) => {
            if (node) return;
            if (innerNode.type === "tags_in") {
                // @ts-ignore
                node = RED.nodes.getNode(innerNode.id);
                return;
            }
        });
        if (!node) return;
        const currentTags: ITagStorage = node.context().global.get(ALL_TAGS_STORAGE) as ITagStorage || {};
        const tagList: string[] = [];
        for (const tag in currentTags) {
            tagList.push(tag + (currentTags[tag].desc ? (" - " + currentTags[tag].desc) : ""))
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

        if (config.isToEmitAllChanges) {
            //
            // ============= This is if ALL tag changes emitted ==============
            //
            eventEmitter.on(CHANGES_TOPIC, handleAnyTagChange);
            if (config.emitOnStart)
                RED.events.on("flows:started", emitOnStart)

            node.on("input", emitCurrentTags);
            node.on("close", () => {
                eventEmitter.removeListener(CHANGES_TOPIC, handleAnyTagChange)
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
        if (!tagNames.length) return;

        const currentTags: ITagStorage = node.context().global.get(ALL_TAGS_STORAGE) || {};
        let batch: {[key: string]: any} | undefined;

        for (const tag of tagNames) {
            eventEmitter.on(tag, handleTagChanges);
        }


        if (config.emitOnStart)
            RED.events.on("flows:started", emitOnStart);

        node.on("input", emitCurrentTags);
        node.on("close", () => {
            tagNames.forEach(tag => eventEmitter.removeListener(tag, handleTagChanges));
        })



        function emitOnStart() {
            emitCurrentTags();

            RED.events.removeListener("flows:started", emitOnStart);
        }

        function emitCurrentTags() {
            if (config.isToEmitAllChanges) {
                const currentTags: ITagStorage = node.context().global.get(ALL_TAGS_STORAGE) || {};

                if (Object.keys(currentTags).length)
                    handleAnyTagChange(currentTags);

            } else {
                tagNames.forEach(tag => handleTagChanges(tag, currentTags[tag]));
            }
        }

        function handleTagChanges(changedTag: string, tagChange?: IStorageTag) {
            if (!tagChange) return;

            if (tagNames.length === 1) sendNodeMessage(changedTag, tagChange.value);
            else sendTagValues();


            function sendTagValues() {

                // IF batch formed ignore this function
                if (batch) return;

                batch = {};
                tagNames.forEach(tag => {
                    if (currentTags[tag] && batch) batch[tag] = currentTags[tag].value
                });

                // run function sendNodeMessage in next JS loop
                setTimeout(() => {
                    sendNodeMessage("__batch", batch);
                    batch = undefined;
                }, 0)
            }

            function sendNodeMessage(topic: string, payload: any) {
                node.send({ topic, payload })
            }
        }

        function handleAnyTagChange(changes: ITagStorage) {
            const payload: {[key: string]: any} = {};
            const tags = Object.keys(changes);
            for (const tagName of tags) {
                payload[tagName] = changes[tagName].value
            }

            node.send({ topic: "__batch_all", payload})
        }
    }




    function TagsIn(config: IMonitorTagsConfig) {
        // @ts-ignore
        RED.nodes.createNode(this, config);
        const node = this;

        node.on("input", (msg: any) => {

            const isTooOften = checkIfTooOften();
            lastCall_ms = Date.now();
            if (isTooOften) {
                node.error("Emit cancelled, the node called TOO often!");
                return;
            }


            const currentTags: ITagStorage = node.context().global.get(ALL_TAGS_STORAGE) || {};
            const change: ITagStorage = {};

            if (msg.deleteTag) {
                const tag = currentTags[msg.topic];

                if (tag) {
                    delete currentTags[msg.topic];
                    node.warn(`Tag with name '${msg.topic}' DELETED`);
                } else {
                    node.warn(`Tag with name '${msg.topic}' NOT FOUND`);
                }
                return;
            }

            if (config.isBatch || msg.topic === "__batch") {

                // this is then BATCH Tag IN

                const newKeys = Object.keys(msg.payload || {});
                const newDescriptions = Object.keys(msg.desc || {});
                if (!newKeys.length && !newDescriptions.length) return;

                for (const key of newKeys) {
                    const tagName = key;
                    const newValue = msg.payload[key];
                    buildChange(tagName, newValue, currentTags, change)
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

                const newValue = msg.payload;
                buildChange(tagName, newValue, currentTags, change);

                // override config description with the incoming message .desc property
                if (typeof msg.desc === "string")
                    currentTags[tagName].desc = msg.desc;
                else if (config.desc)
                    currentTags[tagName].desc = config.desc;
            }

            node.send(msg);

            if (!Object.keys(change).length) return;

            node.context().global.set(ALL_TAGS_STORAGE, currentTags);
            for (const changedTag in change) {
                eventEmitter.emit(changedTag, changedTag, change[changedTag]);
            }
            eventEmitter.emit(CHANGES_TOPIC, change);
        });



        function buildChange(tagName: string, newValue: any, tagStorage: ITagStorage, change: ITagStorage) {
            // OLD WAY, keep this for testing
            // const currentValue = tagStorage[tagName] ? tagStorage[tagName].value : undefined;
            //
            // if (currentValue == null || isDifferent(newValue, currentValue)) {
            //
            //     if (currentValue && tagStorage[tagName].sourceNodeId !== node.id) {
            //         node.warn(`Tag ${tagName} changed by two different sources. ` +
            //             `From ${tagStorage[tagName].sourceNodeId} to ${node.id}`);
            //     }
            //
            //     change[tagName] = {
            //         tagName,
            //         sourceNodeId: node.id,
            //         value: newValue
            //     }
            //     tagStorage[tagName] = change[tagName];
            // }

            if (!tagStorage[tagName]) {
                tagStorage[tagName] = {
                    tagName,
                    sourceNodeId: node.id,
                    value: 0
                };
            }

            const currentValue = tagStorage[tagName].value;

            if (isDifferent(newValue, currentValue)) {

                if (tagStorage[tagName].sourceNodeId !== node.id) {
                    node.warn(`Tag ${tagName} changed by two different sources. ` +
                        `From ${tagStorage[tagName].sourceNodeId} to ${node.id}`);
                }

                tagStorage[tagName].value = newValue;
                tagStorage[tagName].sourceNodeId = node.id;

                change[tagName] = tagStorage[tagName];
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



function modifyCurrentTags(nodeId: string, oldObject: ITagStorage, newTagValueMap: {[key: string]: any}):
    ITagStorage | undefined
{
    const newKeys = Object.keys(newTagValueMap);
    if (!newKeys) return;

    const changes: ITagStorage = {};

    for (const key of newKeys) {
        if (!oldObject[key] || isDifferent(newTagValueMap[key], oldObject[key].value)) {
            changes[key] = {
                sourceNodeId: nodeId,
                tagName: key,
                value: newTagValueMap[key]
            }
        }
    }

    if (!Object.keys(changes)) return;

    return changes
}

function isDifferent(newValue: any, oldValue: any): boolean {
    if (typeof newValue === "object" && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        return true;
    } else if (typeof newValue !== "object" && oldValue !== newValue) {
        return true;
    }
    return false;
}
