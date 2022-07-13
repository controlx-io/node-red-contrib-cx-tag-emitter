"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const TAGS_STORAGE = "_TAGS_";
const ROOT_STORAGE_PATH = "[root]";
class TagStorage {
    constructor(node, storeName) {
        this.storeName = storeName;
        this.storage = {
            [ROOT_STORAGE_PATH]: {}
        };
        const _storeName = this.storeName === "default" ? undefined : this.storeName;
        const storage = node
            .context()
            .global
            .get(TAGS_STORAGE, _storeName);
        if (storage) {
            this.storage = storage;
        }
        else {
            node
                .context()
                .global
                .set(TAGS_STORAGE, this.storage, _storeName);
        }
    }
    get name() {
        return this.storeName || "";
    }
    static getStoragesByGlobalContext(node, storageName) {
        const _storeName = storageName === "default" ? undefined : storageName;
        const storage = node
            .context()
            .global
            .get(TAGS_STORAGE, _storeName);
        return storage || {};
    }
    setStorage(path) {
        if (!this.storage[path])
            this.storage[path] = {};
        return this.storage[path];
    }
    getStorage(path) {
        path = path || ROOT_STORAGE_PATH;
        return this.storage[path];
    }
    getTag(tagName, path) {
        path = path || ROOT_STORAGE_PATH;
        if (!this.storage[path])
            return;
        return this.storage[path][tagName];
    }
    setTag(tag, path) {
        path = path || ROOT_STORAGE_PATH;
        this.storage[path][tag.name] = tag;
        return tag;
    }
    getNameValueObject(tagIdList, path) {
        path = path || ROOT_STORAGE_PATH;
        const out = {};
        const storage = this.storage[path];
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
    getNameValueObjectFromTagConfigs(tagConfigsList) {
        const out = {};
        for (const tagConf of tagConfigsList) {
            const storage = this.storage[tagConf.path || ""];
            if (!storage)
                continue;
            const tag = storage[tagConf.name];
            if (!tag)
                continue;
            out[tag.name] = tag.value;
        }
        return out;
    }
    deleteTag(tagId, path) {
        path = path || ROOT_STORAGE_PATH;
        const storage = this.storage[path];
        const tag = storage ? storage[tagId] : null;
        if (tag && storage) {
            delete storage[tagId];
            return tagId;
        }
    }
}
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
    const redContextStorage = RED.settings.get("contextStorage");
    const storages = redContextStorage ? Object.keys(redContextStorage) : [];
    if (!storages.includes("default"))
        storages.unshift("default");
    RED.httpAdmin.get('/__cx_tag_emitter/get_storages', (req, res) => {
        res.json(storages).end();
    });
    RED.httpAdmin.get("/__cx_tag_emitter/get_paths", (req, res) => {
        const configNodeId = req.query["config_node_id"];
        const storageName = req.query["storage_name"];
        const isStats = req.query["stats"] === "true";
        const configNode = RED.nodes.getNode(configNodeId);
        if (!configNodeId || !configNode || !configNode.tagStorage) {
            if (isDebug)
                console.log("Something wrong, there is no config node:", configNode);
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
                }];
        });
        res.json(pathsAndStats).end();
    });
    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', (req, res) => {
        const configNodeId = req.query["config_node_id"];
        const parentPath = req.query["parent_path"];
        if (isDebug)
            console.log("GET get_variables:", { configNodeId, parentPath });
        const configNode = RED.nodes.getNode(configNodeId);
        if (!configNodeId || !parentPath || !configNode || !configNode.tagStorage) {
            if (isDebug)
                console.log("Something wrong, there is no config node:", configNode);
            return res.json([]).end();
        }
        const currentTags = configNode.tagStorage.getStorage(parentPath);
        if (!currentTags)
            return res.json([]).end();
        const tagNames = Object.keys(currentTags);
        tagNames.sort();
        const values = {};
        const descriptions = {};
        for (const tag of tagNames) {
            if (!currentTags[tag])
                continue;
            values[tag] = currentTags[tag].value;
            if (currentTags[tag].desc)
                descriptions[tag] = currentTags[tag].desc;
        }
        res.json([tagNames, values, descriptions]).end();
    });
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
    function StorageConfig(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        node.tagStorage = new TagStorage(node, config.storeName);
        if (RED.util.cxGetTag)
            return;
        RED.util.cxGetTag = function (tagName, path, storageName) {
            if (!tagName)
                return;
            storageName = (!storageName || typeof storageName !== "string") ? "default" : storageName;
            const storage = TagStorage.getStoragesByGlobalContext(node, storageName);
            path = (!path || typeof path !== "string") ? ROOT_STORAGE_PATH : path;
            const container = storage[path];
            if (!container)
                return;
            return container[tagName];
        };
    }
    function ValueEmitter(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNodeId = config.storage;
        const configNode = RED.nodes.getNode(configNodeId);
        if (!configNode || !configNode.tagStorage)
            return node.error("Select Storage Node and its context name");
        if (typeof config.path !== "string" || !config.path)
            return node.error("Tags path must be defined");
        const tagStorage = configNode.tagStorage;
        if (config.emitOnStart) {
            const listenerCounts = RED.events.getMaxListeners() + 1;
            RED.events.setMaxListeners(listenerCounts);
        }
        node.status({ fill: "grey", shape: "ring" });
        node.on("input", emitCurrentTags);
        let isError = false;
        if (config.isToEmitAllChanges) {
            const parentPath = config.path;
            eventEmitter.on(parentPath + "/" + ALL_CHANGES_CHANNEL, handleAnyTagChange);
            if (config.emitOnStart)
                RED.events.on("flows:started", emitOnStart);
            node.status({ fill: "grey", shape: "dot", text: "from: " + parentPath });
            node.on("close", () => {
                eventEmitter.removeListener(parentPath + "/" + ALL_CHANGES_CHANNEL, handleAnyTagChange);
            });
            return;
        }
        if (!Array.isArray(config.tags) || !config.tags.length) {
            node.error("Tag Names are not provided");
            return;
        }
        const tagConfigs = config.tags.filter(tagConf => !!tagConf.name);
        if (!tagConfigs.length)
            return;
        const addedTags = tagConfigs.filter(tagConf => tagConf.isAdded);
        const emittedTags = tagConfigs.filter(tagConf => !tagConf.isAdded);
        const isOnlyOneTagToEmit = emittedTags.length === 1 && !addedTags.length;
        let batchQty = 0;
        for (const tag of emittedTags) {
            const tagPath = tag.path + "/" + tag.name;
            eventEmitter.on(tagPath, handleSomeTagChanges);
            if (!tagListenerCounter[tag.name])
                tagListenerCounter[tag.name] = 0;
            tagListenerCounter[tag.name]++;
        }
        const max = Math.max(...Object.values(tagListenerCounter));
        eventEmitter.setMaxListeners(max + 10);
        if (config.emitOnStart)
            RED.events.on("flows:started", emitOnStart);
        node.on("close", () => {
            for (const tag of emittedTags) {
                const tagPath = tag.path + "/" + tag.name;
                eventEmitter.removeListener(tagPath, handleSomeTagChanges);
                tagListenerCounter[tag.name]--;
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
                const parentPath = config.path;
                const currentTags = tagStorage.getStorage(parentPath);
                if (!currentTags) {
                    handleError("No storage");
                    return node.error(`Storage at path "${parentPath}" doesn't exist`);
                }
                else
                    handleError();
                handleAnyTagChange(Object.keys(currentTags));
            }
            else if (emittedTags) {
                emittedTags.forEach(handleSomeTagChanges);
            }
        }
        function handleSomeTagChanges(tagConf) {
            const tagPath = tagConf.path || "";
            const tag = tagStorage.getTag(tagConf.name, tagPath);
            if (!tag)
                return;
            if (isOnlyOneTagToEmit) {
                const valueStr = tag.value == null ? "" : tag.value.toString();
                node.status({ text: valueStr, fill: "grey", shape: "dot" });
                const additionalProps = { prevValue: tag.prevValue };
                if (tag.props)
                    additionalProps.props = tag.props;
                node.send(buildMessage(tagConf.name, tag.value, tagPath, additionalProps));
                return;
            }
            batchQty++;
            if (batchQty > 1)
                return;
            setTimeout(() => {
                const payload = config.isGrouped ?
                    groupByPath(tagConfigs, tagStorage) :
                    tagStorage.getNameValueObjectFromTagConfigs(tagConfigs);
                node.send(buildMessage("__some", payload));
                node.status({ text: batchQty + " change(s)", fill: "grey", shape: "dot" });
                batchQty = 0;
            }, 0);
        }
        function handleAnyTagChange(idListOfChangedTagValues) {
            const parentPath = config.path;
            const payload = tagStorage.getNameValueObject(idListOfChangedTagValues, parentPath);
            if (!Object.keys(payload).length)
                return handleError("Nothing to emit");
            else
                handleError();
            node.send(buildMessage("__all", payload, parentPath));
        }
        function buildMessage(topic, payload, path, additionalProps) {
            additionalProps = additionalProps || {};
            return Object.assign(Object.assign({}, additionalProps), { topic, payload,
                path, storage: tagStorage.name });
        }
        function handleError(text) {
            if (text) {
                isError = true;
                return node.status({ fill: "red", shape: "dot", text });
            }
            if (isError) {
                isError = false;
                node.status("");
            }
        }
    }
    function groupByPath(tagConfigs, tagStorage) {
        const payload = {};
        for (const tagConfig of tagConfigs) {
            const path = tagConfig.path || ROOT_STORAGE_PATH;
            const tag = tagStorage.getTag(tagConfig.name, path);
            if (!tag)
                continue;
            if (!payload[path])
                payload[path] = {};
            payload[path][tag.name] = tag.value;
        }
        return payload;
    }
    function TagsIn(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        const configNodeId = config.storage;
        const configNode = RED.nodes.getNode(configNodeId);
        if (!configNode || !configNode.tagStorage)
            return node.error("Config 'tag-storage' node must be selected");
        if (typeof config.path !== "string" || !config.path)
            return node.error("Tags path must be defined");
        const parentPath = config.path;
        const tagStorage = configNode.tagStorage;
        node.status({ fill: "grey", shape: "ring" });
        node.on("input", (msg) => {
            const isTooOften = checkIfTooOften();
            lastCall_ms = Date.now();
            if (isTooOften) {
                node.error("Emit cancelled, the node called TOO often!");
                return;
            }
            const currentTags = tagStorage.setStorage(parentPath);
            if (msg.deleteTag) {
                msg.topic = msg.topic != null ? msg.topic.toString() : "";
                const deletedTagId = tagStorage.deleteTag(msg.topic, parentPath);
                if (deletedTagId) {
                    node.warn(`Tag '${parentPath}/${msg.topic}' DELETED`);
                    node.status({ text: `DELETED: ${msg.topic}`, fill: "green", shape: "dot" });
                }
                else {
                    node.warn(`Tag '${parentPath}/${msg.topic}' NOT FOUND`);
                    node.status({ text: `NOT FOUND: ${msg.topic}`, fill: "red", shape: "dot" });
                }
                return;
            }
            if (msg.toJSON === true) {
                const storageCopy = {};
                for (const tagName in currentTags) {
                    storageCopy[tagName] = {};
                    storageCopy[tagName].desc = currentTags[tagName].desc || "";
                    storageCopy[tagName].db = currentTags[tagName].db || 0;
                    storageCopy[tagName].value = currentTags[tagName].value;
                }
                const payload = JSON.stringify(storageCopy);
                const length = Object.keys(currentTags).length;
                node.status({ text: `${length} tags exported`, fill: "green", shape: "dot" });
                return node.send({ topic: "toJSON", payload });
            }
            if (msg.toMetrics === true) {
                const spBMetrics = {
                    timestamp: Date.now(),
                    metrics: []
                };
                for (const tagName in currentTags) {
                    const value = currentTags[tagName].value;
                    const props = currentTags[tagName].props ? currentTags[tagName].props : {};
                    const dataType = (props.dataType) ? props.dataType : getSpBDataType(value);
                    const metric = {
                        name: tagName,
                        value, dataType
                    };
                    spBMetrics.metrics.push(metric);
                }
                const length = spBMetrics.metrics.length;
                node.status({ text: `${length} metrics sent`, fill: "green", shape: "dot" });
                return node.send({ topic: "toMetrics", payload: spBMetrics });
            }
            if (msg.setProperties === true) {
                if (!isObject(msg.payload))
                    return node.error(".payload must be and an object type, got " +
                        (msg.payload ? typeof msg.payload : "'null'"));
                for (const tagName in msg.payload) {
                    const tag = addTagIfNotExist(tagName, parentPath);
                    const tagDef = msg.payload[tagName];
                    if (tagDef.desc && typeof tagDef.desc === "string")
                        tag.desc = tagDef.desc;
                    if (tagDef.db && typeof tagDef.db === "number")
                        tag.db = tagDef.db;
                    if (tagDef.props && typeof tagDef.props === "object")
                        tag.props = tagDef.props;
                }
                const tagDefQty = Object.keys(msg.payload).length;
                node.status({ text: `${tagDefQty} properties set`, fill: "green", shape: "dot" });
                node.warn(`Added properties for ${tagDefQty} tags.`);
                return;
            }
            const namesOfChangedTags = [];
            if (config.isBatch) {
                if (!isObject(msg.payload))
                    return node.error(".payload must be and an object type, got " +
                        (msg.payload ? typeof msg.payload : "'null'"));
                const newKeys = Object.keys(msg.payload || {});
                if (!newKeys.length)
                    return;
                for (const key of newKeys) {
                    const tagName = key;
                    const newValue = msg.payload[key];
                    const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath);
                    if (changedTag)
                        namesOfChangedTags.push(changedTag.name);
                }
                if (namesOfChangedTags.length)
                    node.status({ text: namesOfChangedTags.length + " tag(s) in", fill: "grey", shape: "dot" });
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
                if (typeof msg.db === "number" && isFinite(msg.db))
                    currentTags[tagName].db = msg.db;
                else if (config.deadband) {
                    const db = Number.parseFloat(config.deadband);
                    currentTags[tagName].db = isFinite(db) ? db : 0;
                }
                if (namesOfChangedTags.length)
                    node.status({ text: newValue.toString(), fill: "grey", shape: "dot" });
            }
            if (!namesOfChangedTags.length)
                return;
            const newMsg = {};
            if (config.isBatch) {
                newMsg.topic = msg.topic;
                newMsg.payload = tagStorage.getNameValueObject(namesOfChangedTags, parentPath);
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
                const tagConfig = { path: parentPath, name: changedTag };
                eventEmitter.emit(tagPath, tagConfig);
            }
            eventEmitter.emit(parentPath + "/" + ALL_CHANGES_CHANNEL, namesOfChangedTags);
        });
        function setNewTagValueIfChanged(tagId, newValue, path) {
            if (typeof newValue === "function")
                return;
            const tag = addTagIfNotExist(tagId, path);
            const currentValue = tag.value;
            if (isDifferent(newValue, currentValue)) {
                if (tag.sourceNodeId && tag.sourceNodeId !== node.id) {
                    node.warn(`Tag ${tagId} changed by two different sources. ` +
                        `From ${tag.sourceNodeId} to ${node.id}`);
                    tag.sourceNodeId = node.id;
                }
                if (tag.db && typeof newValue === "number" && typeof currentValue === "number") {
                    const diff = Math.abs(newValue - currentValue);
                    if (diff < tag.db) {
                        return;
                    }
                }
                tag.value = newValue;
                return tag;
            }
        }
        function addTagIfNotExist(tagId, path) {
            const tagFromStore = tagStorage.getTag(tagId, path);
            const tag = tagFromStore ? tagFromStore : new Tag(tagId, node.id);
            if (!tagFromStore)
                tagStorage.setTag(tag, path);
            return tag;
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
    RED.nodes.registerType("tag-storage", StorageConfig);
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
function isObject(obj) {
    return !!obj && obj.constructor.name === "Object";
}
function getSpBDataType(value) {
    switch (typeof value) {
        case "boolean":
            return "Boolean";
        case "number": {
            if (Number.isInteger(value))
                return "Int64";
            else
                return "Double";
        }
        case "string":
            return "String";
    }
    return "Unknown";
}
//# sourceMappingURL=cx_tag_emitter.js.map