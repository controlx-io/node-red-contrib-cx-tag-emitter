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
    const eventEmitter = new events_1.EventEmitter();
    let lastCall_ms = 0;
    let at10msCounter = 0;
    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', (req, res) => __awaiter(this, void 0, void 0, function* () {
        let node;
        RED.nodes.eachNode((innerNode) => {
            if (node)
                return;
            if (innerNode.type === "tags_in") {
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
        const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
        let batch;
        for (const tag of tagNames) {
            eventEmitter.on(tag, handleTagChanges);
        }
        if (config.emitOnStart)
            RED.events.on("flows:started", () => {
                tagNames.forEach(tag => handleTagChanges(tag, currentTags[tag]));
            });
        node.on("close", () => {
            tagNames.forEach(tag => eventEmitter.removeListener(tag, handleTagChanges));
        });
        function handleTagChanges(changedTag, tagChange) {
            if (!tagChange)
                return;
            if (tagNames.length === 1)
                sendNodeMessage(changedTag, tagChange.value);
            else
                sendTagValues();
            function sendTagValues() {
                if (batch)
                    return;
                batch = {};
                tagNames.forEach(tag => {
                    if (currentTags[tag] && batch)
                        batch[tag] = currentTags[tag].value;
                });
                setTimeout(() => {
                    sendNodeMessage("__batch", batch);
                    batch = undefined;
                }, 0);
            }
            function sendNodeMessage(topic, payload) {
                node.send({ topic, payload });
            }
        }
    }
    function TagsIn(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.on("input", (msg) => {
            if (!msg.topic || typeof msg.topic !== "string") {
                node.error("Invalid Topic: " + JSON.stringify(msg.topic));
                return;
            }
            const isTooOften = checkIfTooOften();
            if (isTooOften) {
                node.error("Emit cancelled, the node called TOO often!");
                return;
            }
            const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
            const change = {};
            if (config.isBatch || msg.topic === "__batch") {
                const newKeys = Object.keys(msg.payload);
                if (!newKeys)
                    return;
                for (const key of newKeys) {
                    const tagName = key;
                    const newValue = msg.payload[key];
                    buildChange(tagName, newValue, currentTags, change, true);
                }
            }
            else {
                if (msg.payload == null)
                    return;
                const tagName = config.tagName || msg.topic;
                const newValue = msg.payload;
                buildChange(tagName, newValue, currentTags, change, false);
            }
            if (!Object.keys(change))
                return;
            node.context().global.set(ALL_TAGS_STORAGE, currentTags);
            for (const changedTag in change) {
                eventEmitter.emit(changedTag, changedTag, change[changedTag]);
            }
        });
        function buildChange(tagName, newValue, tagStorage, change, isBatch) {
            const currentValue = tagStorage[tagName] ? tagStorage[tagName].value : undefined;
            if (currentValue == null || isDifferent(newValue, currentValue)) {
                if (currentValue && tagStorage[tagName].sourceNodeId !== node.id) {
                    node.warn(`Tag ${tagName} changed by two different sources. ` +
                        `From ${tagStorage[tagName].sourceNodeId} to ${node.id}`);
                }
                change[tagName] = {
                    tagName,
                    sourceNodeId: node.id,
                    value: newValue
                };
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
    RED.nodes.registerType("tags_in", TagsIn);
};
function modifyCurrentTags(nodeId, oldObject, newTagValueMap) {
    const newKeys = Object.keys(newTagValueMap);
    if (!newKeys)
        return;
    const changes = {};
    for (const key of newKeys) {
        if (!oldObject[key] || isDifferent(newTagValueMap[key], oldObject[key].value)) {
            changes[key] = {
                sourceNodeId: nodeId,
                tagName: key,
                value: newTagValueMap[key]
            };
        }
    }
    if (!Object.keys(changes))
        return;
    return changes;
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
//# sourceMappingURL=cx_tag_emitter.js.map