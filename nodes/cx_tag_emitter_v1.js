"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
module.exports = function (RED) {
    const ALL_TAGS_STORAGE = "__ALL_TAGS__";
    const CHANGE_EMIT_TOPIC = "__CHANGE__";
    const eventEmitter = new events_1.EventEmitter();
    let lastCall_ms = 0;
    let at10msCounter = 0;
    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', (req, res) => __awaiter(this, void 0, void 0, function* () {
        let node;
        RED.nodes.eachNode((innerNode) => {
            if (node)
                return;
            if (innerNode.type === "tag_monitoring") {
                node = RED.nodes.getNode(innerNode.id);
                return;
            }
        });
        if (!node)
            return;
        const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
        const tagList = Object.keys(currentTags);
        res.json(tagList).end();
    }));
    function ValueEmitter(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        if (!config.tagName || typeof config.tagName !== "string") {
            node.error("Tag Name is not provided");
            return;
        }
        const tagNames = config.tagName.split(",").map(tag => tag.toString().trim()).filter(tag => !!tag);
        if (!tagNames.length)
            return;
        eventEmitter.on(CHANGE_EMIT_TOPIC, handleTagChanges);
        function handleTagChanges(change, tagEmitterId) {
            if (tagNames.length === 1)
                sendTagValue(change, tagEmitterId);
            else
                sendTagValues(change, tagEmitterId);
        }
        function sendTagValue(change, tagEmitterId) {
            const tag = tagNames[0];
            if (!change.hasOwnProperty(tag))
                return;
            if (tagEmitterId === node.id) {
                console.log("Same node, NOT emitting the tag: " + tag);
                return;
            }
            sendNodeMessage(tag, change[tag]);
        }
        function sendTagValues(change, tagEmitterId) {
            const isThereChange = tagNames.some(tag => change.hasOwnProperty(tag));
            if (!isThereChange)
                return;
            if (tagEmitterId === node.id) {
                console.log("Same node, NOT emitting the __batch!");
                return;
            }
            const batch = {};
            const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
            for (const tagName of tagNames) {
                const isTagChanged = change.hasOwnProperty(tagName);
                batch[tagName] = isTagChanged ? change[tagName] : currentTags[tagName];
            }
            sendNodeMessage("__batch", batch);
        }
        function sendNodeMessage(topic, payload) {
            const _tagEmitterId = node.id;
            node.send({ topic, payload, _tagEmitterId });
        }
        if (config.emitOnStart)
            RED.events.on("flows:started", () => {
                const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
                handleTagChanges(currentTags);
            });
        node.on("close", () => {
            eventEmitter.removeListener(CHANGE_EMIT_TOPIC, handleTagChanges);
        });
    }
    function MonitorTags(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.on("input", (msg) => {
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
            let change;
            if (msg.topic === "__batch") {
                change = filterNewValues(currentTags, msg.payload);
            }
            else if (isDifferent(msg.payload, currentTags[msg.topic])) {
                change = { [msg.topic]: msg.payload };
            }
            if (!change)
                return;
            currentTags = Object.assign(Object.assign({}, currentTags), change);
            eventEmitter.emit(CHANGE_EMIT_TOPIC, change, tagEmitterId);
            node.context().global.set(ALL_TAGS_STORAGE, currentTags);
        });
    }
    function checkIfTooOften() {
        if (Date.now() - lastCall_ms < 50) {
            at10msCounter++;
        }
        else {
            at10msCounter = 0;
            return false;
        }
        lastCall_ms = Date.now();
        const at10msFor100times = at10msCounter >= 100;
        if (at10msFor100times)
            at10msCounter = 100;
        return at10msFor100times;
    }
    RED.nodes.registerType("value_emitter", ValueEmitter);
    RED.nodes.registerType("tag_monitoring", MonitorTags);
};
function filterNewValues(oldObject, newObject) {
    const newKeys = Object.keys(newObject);
    if (!newKeys)
        return;
    const newValues = {};
    for (const key of newKeys) {
        if (isDifferent(newObject[key], oldObject[key]))
            newValues[key] = newObject[key];
    }
    return newValues;
}
function isDifferent(newValue, oldValue) {
    if (typeof newValue === "object" && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        return true;
    }
    else if (typeof newValue !== "object" && oldValue !== newValue) {
        return true;
    }
    return false;
}
//# sourceMappingURL=cx_tag_emitter_v1.js.map