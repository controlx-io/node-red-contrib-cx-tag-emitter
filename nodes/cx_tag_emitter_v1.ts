import {Node, NodeRedApp} from "node-red";
import {EventEmitter} from "events";

interface IMonitorTagsConfig {
    name: string
}

interface IValueEmitterConfig {
    name: string,
    tagName: string,
    emitOnStart: boolean
}

interface ITagBatch {
    [key: string]: any
}

// interface configNodeSpace {
//     eventEmitter: EventEmitter,
//     currentTags: {[key: string]: boolean | number | string}
// }

module.exports = function (RED: NodeRedApp) {

    const ALL_TAGS_STORAGE = "__ALL_TAGS__";
    const CHANGE_EMIT_TOPIC = "__CHANGE__";

    const eventEmitter =  new EventEmitter();

    let lastCall_ms = 0;
    let at10msCounter = 0;

    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', async (req, res) => {
        // console.log(req.query);
        let node: Node;
        // @ts-ignore
        RED.nodes.eachNode((innerNode: Node) => {
            if (node) return;
            if (innerNode.type === "tag_monitoring") {
                // @ts-ignore
                node = RED.nodes.getNode(innerNode.id);
                return;
            }
        });
        if (!node) return;
        const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
        const tagList = Object.keys(currentTags);
        res.json(tagList).end();
    });

    /**
     *
     *  ========== Monitor Tags Node ===========
     *  On inout of tags it stores the tag values and emits to the subscribed nodes.
     *  On topic "__emit_all__" emits all available tags
     *  On input of the same message as
     */

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

        eventEmitter.on(CHANGE_EMIT_TOPIC, handleTagChanges);

        function handleTagChanges(change: ITagBatch, tagEmitterId?: string) {

            if (tagNames.length === 1)
                sendTagValue(change, tagEmitterId);
            else
                sendTagValues(change, tagEmitterId);
        }

        function sendTagValue(change: ITagBatch, tagEmitterId?: string) {
            const tag = tagNames[0];

            // check IF the 'change' doesn't have the tag OR it was sent by the same node
            if (!change.hasOwnProperty(tag)) return;

            if (tagEmitterId === node.id) {
                console.log("Same node, NOT emitting the tag: " + tag);
                return
            }

            sendNodeMessage(tag, change[tag]);
        }

        function sendTagValues(change: ITagBatch, tagEmitterId?: string) {

            const isThereChange = tagNames.some(tag => change.hasOwnProperty(tag));
            if (!isThereChange) return;

            if (tagEmitterId === node.id) {
                console.log("Same node, NOT emitting the __batch!");
                return
            }

            const batch: {[key:string]: any} = {};
            const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};

            for (const tagName of tagNames) {
                const isTagChanged = change.hasOwnProperty(tagName);
                batch[tagName] = isTagChanged ? change[tagName] : currentTags[tagName];
            }

            sendNodeMessage("__batch", batch);
        }

        function sendNodeMessage(topic: string, payload: any) {
            const _tagEmitterId = node.id;
            node.send({ topic, payload, _tagEmitterId })
        }


        if (config.emitOnStart)
            RED.events.on("flows:started", () => {
                const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
                handleTagChanges(currentTags);
            })

        node.on("close", () => {
            eventEmitter.removeListener(CHANGE_EMIT_TOPIC, handleTagChanges)
        })
    }




    function MonitorTags(config: IMonitorTagsConfig) {
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
                node.error("Emit cancelled, called TOO often!");
                return;
            }

            const tagEmitterId = msg._tagEmitterId;
            let currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
            let change: ITagBatch | undefined;
            if (msg.topic === "__batch") {
                change = filterNewValues(currentTags, msg.payload);
            } else if (isDifferent(msg.payload, currentTags[msg.topic])) {
                change = {[msg.topic]: msg.payload}
            }

            if (!change) return;

            currentTags = {...currentTags, ...change};
            eventEmitter.emit(CHANGE_EMIT_TOPIC, change, tagEmitterId);
            node.context().global.set(ALL_TAGS_STORAGE, currentTags);
        });
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
    RED.nodes.registerType("tag_monitoring", MonitorTags);
}



function filterNewValues(oldObject: {[key: string]: any}, newObject: {[key: string]: any}):
    {[key: string]: string | number | boolean} | undefined
{
    const newKeys = Object.keys(newObject);
    if (!newKeys) return;

    const newValues: {[key: string]: any} = {};

    for (const key of newKeys) {
        if (isDifferent(newObject[key], oldObject[key])) newValues[key] = newObject[key];
    }

    return newValues
}

function isDifferent(newValue: any, oldValue: any): boolean {
    if (typeof newValue === "object" && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        return true;
    } else if (typeof newValue !== "object" && oldValue !== newValue) {
        return true;
    }
    return false;
}
