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
    const CHANGES_TOPIC = "__CHANGES__";
    const eventEmitter = new events_1.EventEmitter();
    let lastCall_ms = 0;
    let at10msCounter = 0;
    let emitOnStartCounter = 0;
    let tagListenerCounter = {};
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
        const tagList = [];
        for (const tag in currentTags) {
            tagList.push(tag + (currentTags[tag].desc ? (" - " + currentTags[tag].desc) : ""));
        }
        res.json(tagList).end();
    }));
    RED.httpAdmin.post("/__cx_tag_emitter/emit_request/:id", (req, res) => {
        const node = RED.nodes.getNode(req.params.id);
        if (node != null) {
            try {
                node.receive();
                res.sendStatus(200);
            }
            catch (err) {
                res.sendStatus(500);
                node.error("Failed to Emit on button");
            }
        }
        else {
            res.sendStatus(404);
        }
    });
    function ValueEmitter(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        if (config.emitOnStart)
            emitOnStartCounter++;
        RED.events.setMaxListeners(emitOnStartCounter + 10);
        if (config.isToEmitAllChanges) {
            eventEmitter.on(CHANGES_TOPIC, handleAnyTagChange);
            if (config.emitOnStart)
                RED.events.on("flows:started", emitOnStart);
            node.on("input", emitCurrentTags);
            node.on("close", () => {
                eventEmitter.removeListener(CHANGES_TOPIC, handleAnyTagChange);
            });
            return;
        }
        if (!config.tagName || typeof config.tagName !== "string") {
            node.error("Tag Name is not provided");
            return;
        }
        const tagNames = config.tagName.split(",").map(tag => tag.toString().trim()).filter(tag => !!tag);
        const addedTagNames = !config.addedTagName ? [] :
            config.addedTagName.split(",").map(tag => tag.toString().trim()).filter(tag => !!tag);
        if (!tagNames.length)
            return;
        const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
        let batch;
        for (const tag of tagNames) {
            eventEmitter.on(tag, handleTagChanges);
            if (!tagListenerCounter[tag])
                tagListenerCounter[tag] = 0;
            tagListenerCounter[tag]++;
            const max = Math.max(...Object.values(tagListenerCounter));
            eventEmitter.setMaxListeners(max + 10);
        }
        if (config.emitOnStart)
            RED.events.on("flows:started", emitOnStart);
        node.on("input", emitCurrentTags);
        node.on("close", () => {
            tagNames.forEach(tag => {
                eventEmitter.removeListener(tag, handleTagChanges);
                tagListenerCounter[tag]--;
            });
        });
        function emitOnStart() {
            emitCurrentTags();
            RED.events.removeListener("flows:started", emitOnStart);
            emitOnStartCounter--;
        }
        function emitCurrentTags() {
            if (config.isToEmitAllChanges) {
                const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
                if (Object.keys(currentTags).length)
                    handleAnyTagChange(currentTags);
            }
            else {
                tagNames.forEach(tag => handleTagChanges(tag, currentTags[tag]));
            }
        }
        function handleTagChanges(changedTag, tagChange) {
            if (!tagChange)
                return;
            if (tagNames.length === 1 && !addedTagNames.length)
                sendNodeMessage(changedTag, tagChange.value);
            else
                sendTagValues();
            function sendTagValues() {
                if (batch)
                    return;
                batch = {};
                for (const tag of tagNames)
                    if (currentTags[tag])
                        batch[tag] = currentTags[tag].value;
                for (const tag of addedTagNames)
                    if (currentTags[tag])
                        batch[tag] = currentTags[tag].value;
                setTimeout(() => {
                    sendNodeMessage("__batch", batch);
                    batch = undefined;
                }, 0);
            }
            function sendNodeMessage(topic, payload) {
                node.send({ topic, payload });
            }
        }
        function handleAnyTagChange(changes) {
            const payload = {};
            const tags = Object.keys(changes);
            for (const tagName of tags) {
                payload[tagName] = changes[tagName].value;
            }
            node.send({ topic: "__batch_all", payload });
        }
    }
    function TagsIn(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.on("input", (msg) => {
            const isTooOften = checkIfTooOften();
            lastCall_ms = Date.now();
            if (isTooOften) {
                node.error("Emit cancelled, the node called TOO often!");
                return;
            }
            const currentTags = node.context().global.get(ALL_TAGS_STORAGE) || {};
            const change = {};
            if (msg.deleteTag) {
                const tag = currentTags[msg.topic];
                if (tag) {
                    delete currentTags[msg.topic];
                    node.warn(`Tag with name '${msg.topic}' DELETED`);
                }
                else {
                    node.warn(`Tag with name '${msg.topic}' NOT FOUND`);
                }
                return;
            }
            if (config.isBatch || msg.topic === "__batch") {
                const newKeys = Object.keys(msg.payload || {});
                const newDescriptions = Object.keys(msg.desc || {});
                if (!newKeys.length && !newDescriptions.length)
                    return;
                for (const key of newKeys) {
                    const tagName = key;
                    const newValue = msg.payload[key];
                    buildChange(tagName, newValue, currentTags, change);
                }
                for (const tagName of newDescriptions) {
                    currentTags[tagName].desc = msg.desc[tagName].toString();
                }
            }
            else {
                const tagName = config.tagName || msg.topic;
                if (!tagName || typeof tagName !== "string") {
                    node.error("Invalid Tag Name: " + JSON.stringify(tagName));
                    return;
                }
                if (msg.payload == null)
                    return;
                const newValue = msg.payload;
                buildChange(tagName, newValue, currentTags, change);
                if (typeof msg.desc === "string")
                    currentTags[tagName].desc = msg.desc;
                else if (config.desc)
                    currentTags[tagName].desc = config.desc;
            }
            node.send(msg);
            if (!Object.keys(change).length)
                return;
            node.context().global.set(ALL_TAGS_STORAGE, currentTags);
            for (const changedTag in change) {
                eventEmitter.emit(changedTag, changedTag, change[changedTag]);
            }
            eventEmitter.emit(CHANGES_TOPIC, change);
        });
        function buildChange(tagName, newValue, tagStorage, change) {
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
            at10msCounter++;
        }
        else {
            at10msCounter = 0;
            return false;
        }
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