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
}

interface IValueEmitterConfig {
    name: string,
    tagName: string | number,
    emitOnStart: boolean,
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
        const tagList = Object.keys(currentTags);
        res.json(tagList).end();
    });




    function ValueEmitter(config: IValueEmitterConfig) {
        // @ts-ignore
        RED.nodes.createNode(this, config);
        const node = this;

        if (!config.tagName || typeof config.tagName !== "string") {
            node.error("Tag Name is not provided");
            return;
        }

        const tagNames = config.tagName.split(",").map(tag => tag.toString().trim()).filter(tag => !!tag);
        if (!tagNames.length) return;

        const currentTags: ITagStorage = node.context().global.get(ALL_TAGS_STORAGE) || {};
        let batch: {[key: string]: any} | undefined;

        for (const tag of tagNames) {
            eventEmitter.on(tag, handleTagChanges);
        }

        if (config.emitOnStart)
            RED.events.on("flows:started", () => {
                tagNames.forEach(tag => handleTagChanges(tag, currentTags[tag]));
            })

        node.on("close", () => {
            tagNames.forEach(tag => eventEmitter.removeListener(tag, handleTagChanges));
        })



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
    }




    function TagsIn(config: IMonitorTagsConfig) {
        // @ts-ignore
        RED.nodes.createNode(this, config);
        const node = this;

        node.on("input", (msg: any) => {

            if (!msg.topic || typeof msg.topic !== "string") {
                node.error("Invalid Topic: " + JSON.stringify(msg.topic));
                return;
            }

            const isTooOften = checkIfTooOften();
            if (isTooOften) {
                node.error("Emit cancelled, the node called TOO often!");
                return;
            }


            const currentTags: ITagStorage = node.context().global.get(ALL_TAGS_STORAGE) || {};
            const change: ITagStorage = {};

            if (config.isBatch || msg.topic === "__batch") {
                const newKeys = Object.keys(msg.payload);
                if (!newKeys) return;

                for (const key of newKeys) {
                    const tagName = key;
                    const newValue = msg.payload[key];
                    buildChange(tagName, newValue, currentTags, change, true)
                }
            } else {
                if (msg.payload == null) return;

                const tagName = config.tagName || msg.topic;
                const newValue = msg.payload;
                buildChange(tagName, newValue, currentTags, change, false)
            }


            if (!Object.keys(change)) return;

            node.context().global.set(ALL_TAGS_STORAGE, currentTags);
            for (const changedTag in change) {
                eventEmitter.emit(changedTag, changedTag, change[changedTag]);
            }
        });



        function buildChange(tagName: string, newValue: any, tagStorage: ITagStorage, change: ITagStorage, isBatch: boolean) {
            const currentValue = tagStorage[tagName] ? tagStorage[tagName].value : undefined;

            if (!currentValue || isDifferent(newValue, currentValue)) {
                change[tagName] = {
                    tagName,
                    sourceNodeId: node.id,
                    value: newValue
                }
                tagStorage[tagName] = change[tagName];

                if (!isBatch) {
                    tagStorage[tagName].dType = config.dType;
                    tagStorage[tagName].desc = config.desc;
                }
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

        lastCall_ms = Date.now();

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
