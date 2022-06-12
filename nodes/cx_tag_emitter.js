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
const ALL_TAGS_STORAGE = "__ALL_TAGS__";
class TagStorage {
    static setGlobalStorage(global) {
        if (TagStorage.globalContext)
            return;
        TagStorage.globalContext = global;
        TagStorage.globalContext.set(ALL_TAGS_STORAGE, TagStorage.storage);
    }
    static getStorage(path) {
        if (path)
            return TagStorage.storage[path];
        return TagStorage.storage.root;
    }
    static getTag(tagName, path) {
        if (path)
            return TagStorage.storage[path][tagName];
        return TagStorage.storage.root[tagName];
    }
    static setTag(tag, path) {
        if (path)
            TagStorage.storage[path][tag.name] = tag;
        else
            TagStorage.storage.root[tag.name] = tag;
        return tag;
    }
    static getNameValueObject(tagIdList, path) {
        const out = {};
        const storage = path ? TagStorage.storage[path] : TagStorage.storage.root;
        if (!storage)
            return out;
        for (const tagId of tagIdList) {
            const tag = storage[tagId];
            if (!tag)
                continue;
            out[tag.name] = tag.value;
        }
        return out;
    }
    static deleteTag(tagId, path) {
        const storage = path ? TagStorage.storage[path] : TagStorage.storage.root;
        const tag = storage ? storage[tagId] : null;
        if (tag && storage) {
            delete storage[tagId];
            return tagId;
        }
    }
}
TagStorage.storage = {
    root: {}
};
class Tag {
    constructor(_name, sourceNodeId) {
        this._name = _name;
        this.sourceNodeId = sourceNodeId;
        this._value = null;
        this._prevValue = null;
        if (!_name)
            this._name = "unnamed";
    }
    get prevValue() {
        return this._prevValue;
    }
    get value() {
        return this._value;
    }
    set value(value) {
        this._prevValue = this._value;
        this._value = value;
    }
    get name() {
        return this._name;
    }
}
const isDebug = !!process.env["TAG_EMITTER_NODE"];
module.exports = function (RED) {
    const ALL_CHANGES_CHANNEL = "__ALL_CHANGES__";
    const eventEmitter = new events_1.EventEmitter();
    let lastCall_ms = 0;
    let at10msCounter = 0;
    let tagListenerCounter = {};
    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', (req, res) => __awaiter(this, void 0, void 0, function* () {
        const parentPath = "";
        const currentTags = TagStorage.getStorage(parentPath);
        const tagList = [];
        for (const tag in currentTags) {
            const { desc, value } = currentTags[tag];
            const tagString = tag + "\t " + (typeof currentTags[tag].value === "object" ? JSON.stringify(value) : value) + (desc ? ("\t\t" + desc) : "");
            tagList.push(tagString);
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
        if (config.emitOnStart) {
            const listenerCounts = RED.events.getMaxListeners() + 1;
            RED.events.setMaxListeners(listenerCounts);
        }
        node.on("input", emitCurrentTags);
        const parentPath = config.path ? config.path : "";
        if (config.isToEmitAllChanges) {
            eventEmitter.on(ALL_CHANGES_CHANNEL, handleAnyTagChange);
            if (config.emitOnStart)
                RED.events.on("flows:started", emitOnStart);
            node.on("close", () => {
                eventEmitter.removeListener(ALL_CHANGES_CHANNEL, handleAnyTagChange);
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
        let isBatchSent = false;
        for (const tagName of tagNames) {
            const tagPath = parentPath + "/" + tagName;
            eventEmitter.on(tagPath, handleSomeTagChanges);
            if (!tagListenerCounter[tagName])
                tagListenerCounter[tagName] = 0;
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
        });
        function emitOnStart() {
            emitCurrentTags();
            RED.events.removeListener("flows:started", emitOnStart);
            const listenerCounts = (RED.events.getMaxListeners() - 1) < 10 ? 10 : RED.events.getMaxListeners() - 1;
            RED.events.setMaxListeners(listenerCounts);
        }
        function emitCurrentTags() {
            if (config.isToEmitAllChanges) {
                const currentTags = TagStorage.getStorage(parentPath);
                handleAnyTagChange(Object.keys(currentTags));
            }
            else {
                tagNames.forEach(handleSomeTagChanges);
            }
        }
        function handleSomeTagChanges(tagName) {
            const tag = TagStorage.getTag(tagName, parentPath);
            if (!tag)
                return;
            const isOnlyOneTagToEmit = tagNames.length === 1 && !addedTagNames.length;
            if (isOnlyOneTagToEmit) {
                node.send({ topic: tagName, payload: tag.value, prevValue: tag.prevValue });
                return;
            }
            if (isBatchSent)
                return;
            const allTagNames = tagNames.concat(addedTagNames);
            const batchObject = TagStorage.getNameValueObject(allTagNames, parentPath);
            node.send({ topic: "__some", payload: batchObject });
            isBatchSent = true;
            setTimeout(() => isBatchSent = false, 0);
        }
        function handleAnyTagChange(idListOfChangedTagValues) {
            const payload = TagStorage.getNameValueObject(idListOfChangedTagValues, parentPath);
            node.send({ topic: "__all", payload });
        }
    }
    function TagsIn(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        if (!TagStorage.globalContext) {
            TagStorage.setGlobalStorage(node.context().global);
        }
        node.on("input", (msg) => {
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
                }
                else {
                    node.warn(`Tag with name '${msg.topic}' NOT FOUND`);
                }
                return;
            }
            const parentPath = config.path ? config.path : "";
            const currentTags = TagStorage.getStorage(parentPath);
            const namesOfChangedTags = [];
            if (config.isBatch) {
                const newKeys = Object.keys(msg.payload || {});
                const newDescriptions = Object.keys(msg.desc || {});
                if (!newKeys.length && !newDescriptions.length)
                    return;
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
                const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath);
                if (!changedTag)
                    return;
                namesOfChangedTags.push(changedTag.name);
                if (typeof msg.desc === "string")
                    currentTags[tagName].desc = msg.desc;
                else if (config.desc)
                    currentTags[tagName].desc = config.desc;
            }
            if (!namesOfChangedTags.length)
                return;
            const newMsg = {};
            if (config.isBatch) {
                newMsg.topic = msg.topic;
                newMsg.payload = TagStorage.getNameValueObject(namesOfChangedTags, parentPath);
            }
            else {
                newMsg.topic = config.tagName || msg.topic;
                if (newMsg.topic) {
                    newMsg.payload = currentTags[newMsg.topic].value;
                    newMsg.prevValue = currentTags[newMsg.topic].prevValue;
                }
            }
            node.send(newMsg);
            for (const changedTag of namesOfChangedTags) {
                const tagPath = parentPath + "/" + changedTag;
                eventEmitter.emit(tagPath, changedTag);
            }
            eventEmitter.emit(ALL_CHANGES_CHANNEL, namesOfChangedTags);
        });
        function setNewTagValueIfChanged(tagId, newValue, path, isToRestore) {
            if (typeof newValue === "function")
                return;
            const tagFromStore = TagStorage.getTag(tagId, path);
            const nodeId = isToRestore ? "" : node.id;
            const tag = tagFromStore ? tagFromStore : new Tag(tagId, nodeId);
            if (!tagFromStore)
                TagStorage.setTag(tag, path);
            const currentValue = tag.value;
            if (isDifferent(newValue, currentValue)) {
                if (tag.sourceNodeId && tag.sourceNodeId !== node.id) {
                    node.warn(`Tag ${tagId} changed by two different sources. ` +
                        `From ${tag.sourceNodeId} to ${node.id}`);
                }
                if (tag.db && typeof newValue === "number" && typeof currentValue === "number") {
                    if (newValue - currentValue < tag.db)
                        return;
                }
                tag.value = newValue;
                if (!isToRestore)
                    tag.sourceNodeId = node.id;
                return tag;
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
function isDifferent(newValue, oldValue) {
    if (oldValue == null && newValue != null) {
        return true;
    }
    else if (typeof newValue === "object" && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        return true;
    }
    else if (typeof newValue !== "object" && oldValue !== newValue) {
        return true;
    }
    return false;
}
//# sourceMappingURL=cx_tag_emitter.js.map