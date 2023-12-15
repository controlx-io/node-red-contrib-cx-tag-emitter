"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TagStorage = exports.TAGS_STORAGE_MODULE = exports.ROOT_STORAGE_PATH = exports.TAGS_STORAGE = void 0;
const events_1 = require("events");
const MAX_CHARACTERS_IN_TAG_VALUE = 18;
const ALL_CHANGES_CHANNEL = '__ALL_CHANGES__';
const eventEmitter = new events_1.EventEmitter();
let lastCall_ms = 0;
let at10msCounter = 0;
const tagListenerCounter = {};
exports.TAGS_STORAGE = '_TAGS_';
exports.ROOT_STORAGE_PATH = '[root]';
exports.TAGS_STORAGE_MODULE = 'default';
class TagStorage {
    get name() {
        return this.storeName || '';
    }
    static getStoragesByGlobalContext(node, storageName) {
        const _storeName = storageName === exports.TAGS_STORAGE_MODULE ? undefined : storageName;
        const storage = node
            .context()
            .global
            .get(exports.TAGS_STORAGE, _storeName);
        return storage || {};
    }
    constructor(node, storeName) {
        this.node = node;
        this.storeName = storeName;
        this.storage = {
            [exports.ROOT_STORAGE_PATH]: {},
        };
        const _storeName = this.storeName === exports.TAGS_STORAGE_MODULE ? undefined : this.storeName;
        const storage = node
            .context()
            .global
            .get(exports.TAGS_STORAGE, _storeName);
        if (storage) {
            this.storage = storage;
        }
        else {
            node
                .context()
                .global
                .set(exports.TAGS_STORAGE, this.storage, _storeName);
        }
    }
    setContext() {
        const _storeName = this.storeName === exports.TAGS_STORAGE_MODULE ? undefined : this.storeName;
        this.node.context().global.set(exports.TAGS_STORAGE, this.storage, _storeName);
    }
    setStorage(path) {
        if (!this.storage[path])
            this.storage[path] = {};
        return this.storage[path];
    }
    getStorage(path) {
        path = path || exports.ROOT_STORAGE_PATH;
        return this.storage[path];
    }
    getTag(tagName, path) {
        path = path || exports.ROOT_STORAGE_PATH;
        if (!this.storage[path])
            return;
        return this.storage[path][tagName];
    }
    setTag(tag, path) {
        path = path || exports.ROOT_STORAGE_PATH;
        if (!this.storage[path])
            this.storage[path] = {};
        this.storage[path][tag.name] = tag;
        this.setContext();
        return tag;
    }
    getNameValueObject(tagIdList, path) {
        path = path || exports.ROOT_STORAGE_PATH;
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
            const storage = this.storage[tagConf.path || ''];
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
        path = path || exports.ROOT_STORAGE_PATH;
        const storage = this.storage[path];
        const tag = storage ? storage[tagId] : null;
        if (tag && storage) {
            delete storage[tagId];
            return tagId;
        }
    }
}
exports.TagStorage = TagStorage;
class CxTagEmitter {
    static getAbsolutePath(tagStorageModule, parentPath, tagName) {
        parentPath = parentPath || exports.ROOT_STORAGE_PATH;
        return tagStorageModule + '/' + parentPath + '/' + tagName;
    }
    static subscribeToTagChanges(tagStorageModule, parentPath, tagName, cb) {
        const tagStorage = CxTagEmitter.tagStorages[tagStorageModule];
        const tagAbsPath = CxTagEmitter.getAbsolutePath(tagStorageModule, parentPath, tagName);
        const callback = (tagConf) => {
            const tagPath1 = tagConf.path || '';
            const tag = tagStorage.getTag(tagConf.name, tagPath1);
            if (tag)
                cb(tag, { name: tagConf.name, path: tagPath1, storageName: tagStorageModule });
        };
        eventEmitter.on(tagAbsPath, callback);
        return () => eventEmitter.removeListener(tagAbsPath, callback);
    }
    static subToChange(tagSubConfs, cb) {
        const unsubscribers = [];
        for (const conf of tagSubConfs) {
            const storeName = conf.storageName || exports.TAGS_STORAGE_MODULE;
            const path = conf.path || exports.ROOT_STORAGE_PATH;
            unsubscribers.push(CxTagEmitter.subscribeToTagChanges(storeName, path, conf.name, cb));
        }
        return unsubscribers;
    }
    static emitTagValueChange(namesOfChangedTags, parentPath, tagStorageModule) {
        tagStorageModule = tagStorageModule || exports.TAGS_STORAGE_MODULE;
        parentPath = parentPath || exports.ROOT_STORAGE_PATH;
        for (const changedTagName of namesOfChangedTags) {
            if (changedTagName == null)
                continue;
            const tagConfig = { path: parentPath, name: changedTagName };
            const tagAbsPath = CxTagEmitter.getAbsolutePath(tagStorageModule, parentPath, changedTagName);
            eventEmitter.emit(tagAbsPath, tagConfig);
        }
        const allTagsAbsPath = CxTagEmitter.getAbsolutePath(tagStorageModule, parentPath, ALL_CHANGES_CHANNEL);
        eventEmitter.emit(allTagsAbsPath, namesOfChangedTags);
    }
    static setTag(tagName, newValue, parentPath, tagStorageModule) {
        tagStorageModule = tagStorageModule || exports.TAGS_STORAGE_MODULE;
        parentPath = parentPath || exports.ROOT_STORAGE_PATH;
        const tagStorage = CxTagEmitter.tagStorages[tagStorageModule];
        const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath, tagStorage);
        if (!changedTag)
            return;
        CxTagEmitter.emitTagValueChange([changedTag.name], parentPath, tagStorageModule);
    }
    static getTag(tagName, parentPath, tagStorageModule) {
        tagStorageModule = tagStorageModule || exports.TAGS_STORAGE_MODULE;
        parentPath = parentPath || exports.ROOT_STORAGE_PATH;
        const tagStorage = CxTagEmitter.tagStorages[tagStorageModule];
        const tag = tagStorage === null || tagStorage === void 0 ? void 0 : tagStorage.getTag(tagName, parentPath);
        return tag;
    }
    static storageConfig(config, node) {
        node.tagStorage = new TagStorage(node, config.storeName);
        CxTagEmitter.tagStorages[config.storeName] = node.tagStorage;
        const intervalId = setInterval(() => { var _a; return (_a = node.tagStorage) === null || _a === void 0 ? void 0 : _a.setContext(); }, 1000);
        node.on('close', () => clearInterval(intervalId));
        if (CxTagEmitter.RED.util.cxGetTag)
            return;
        CxTagEmitter.RED.util.cxGetTag = function (tagName, path, storageName) {
            if (!tagName)
                return;
            storageName = (!storageName || typeof storageName !== 'string') ? exports.TAGS_STORAGE_MODULE : storageName;
            const storage = TagStorage.getStoragesByGlobalContext(node, storageName);
            path = (!path || typeof path !== 'string') ? exports.ROOT_STORAGE_PATH : path;
            const container = storage[path];
            if (!container)
                return;
            return container[tagName];
        };
    }
    static valueEmitter(config, node) {
        const configNodeId = config.storage;
        const configNode = CxTagEmitter.RED.nodes.getNode(configNodeId);
        if (!configNode || !configNode.tagStorage)
            return node.error('Select Storage Node and its context name');
        if (typeof config.path !== 'string' || !config.path)
            return node.error('Tags path must be defined');
        const tagStorage = configNode.tagStorage;
        if (config.emitOnStart) {
            const listenerCounts = CxTagEmitter.RED.events.getMaxListeners() + 1;
            CxTagEmitter.RED.events.setMaxListeners(listenerCounts);
        }
        node.status({ fill: 'grey', shape: 'ring' });
        node.on('input', emitCurrentTags);
        let isError = false;
        if (config.isToEmitAllChanges) {
            const allTagsAbsPath = CxTagEmitter.getAbsolutePath(tagStorage.name, config.path, ALL_CHANGES_CHANNEL);
            eventEmitter.on(allTagsAbsPath, handleAnyTagChange);
            if (config.emitOnStart)
                CxTagEmitter.RED.events.on('flows:started', emitOnStart);
            node.status({ fill: 'grey', shape: 'dot', text: 'from: ' + config.path });
            node.on('close', () => {
                eventEmitter.removeListener(allTagsAbsPath, handleAnyTagChange);
            });
            return;
        }
        if (!Array.isArray(config.tags) || !config.tags.length) {
            node.error('Tag Names are not provided');
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
            const tagAbsPath = CxTagEmitter.getAbsolutePath(tagStorage.name, tag.path, tag.name);
            eventEmitter.on(tagAbsPath, handleSomeTagChanges);
            if (!tagListenerCounter[tag.name])
                tagListenerCounter[tag.name] = 0;
            tagListenerCounter[tag.name] += 1;
        }
        const max = Math.max(...Object.values(tagListenerCounter));
        eventEmitter.setMaxListeners(max + 10);
        if (config.emitOnStart)
            CxTagEmitter.RED.events.on('flows:started', emitOnStart);
        node.on('close', () => {
            for (const tag of emittedTags) {
                const tagAbsPath = CxTagEmitter.getAbsolutePath(tagStorage.name, tag.path, tag.name);
                eventEmitter.removeListener(tagAbsPath, handleSomeTagChanges);
                tagListenerCounter[tag.name] -= 1;
                const listenerCount = eventEmitter.getMaxListeners();
                eventEmitter.setMaxListeners(listenerCount - 1);
            }
        });
        function emitOnStart() {
            emitCurrentTags();
            CxTagEmitter.RED.events.removeListener('flows:started', emitOnStart);
            const listenerCounts = (CxTagEmitter.RED.events.getMaxListeners() - 1) < 10
                ? 10
                : CxTagEmitter.RED.events.getMaxListeners() - 1;
            CxTagEmitter.RED.events.setMaxListeners(listenerCounts);
        }
        function emitCurrentTags() {
            if (config.isToEmitAllChanges) {
                const parentPath = config.path;
                const currentTags = tagStorage.getStorage(parentPath);
                if (!currentTags) {
                    handleError('No storage');
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
            const tagPath = tagConf.path || '';
            const tag = tagStorage.getTag(tagConf.name, tagPath);
            if (!tag)
                return;
            if (isOnlyOneTagToEmit) {
                const text = newValueToString(tag.value);
                node.status({ text, fill: 'grey', shape: 'dot' });
                const additionalProps = { prevValue: tag.prevValue };
                if (tag.props)
                    additionalProps.props = tag.props;
                node.send(buildMessage(tagConf.name, tag.value, tagPath, additionalProps));
                return;
            }
            batchQty += 1;
            if (batchQty > 1)
                return;
            setTimeout(() => {
                const payload = config.isGrouped
                    ? groupByPath(tagConfigs, tagStorage)
                    : tagStorage.getNameValueObjectFromTagConfigs(tagConfigs);
                node.send(buildMessage('__some', payload));
                node.status({ text: batchQty + ' change(s)', fill: 'grey', shape: 'dot' });
                batchQty = 0;
            }, 0);
        }
        function handleAnyTagChange(idListOfChangedTagValues) {
            const parentPath = config.path;
            const payload = tagStorage.getNameValueObject(idListOfChangedTagValues, parentPath);
            if (!Object.keys(payload).length)
                return handleError('Nothing to emit');
            else
                handleError();
            node.send(buildMessage('__all', payload, parentPath));
        }
        function buildMessage(topic, payload, path, additionalProps) {
            additionalProps = additionalProps || {};
            return Object.assign(Object.assign({}, additionalProps), { topic,
                payload,
                path, storage: tagStorage.name });
        }
        function handleError(text) {
            if (text) {
                isError = true;
                return node.status({ fill: 'red', shape: 'dot', text });
            }
            if (isError) {
                isError = false;
                node.status('');
            }
        }
    }
    static tagsIn(config, node) {
        const configNodeId = config.storage;
        const configNode = CxTagEmitter.RED.nodes.getNode(configNodeId);
        if (!configNode || !configNode.tagStorage)
            return node.error("Config 'tag-storage' node must be selected");
        if (typeof config.path !== 'string' || !config.path)
            return node.error('Tags path must be defined');
        const parentPath = config.path;
        const tagStorage = configNode.tagStorage;
        node.status({ fill: 'grey', shape: 'ring' });
        let isFirstCall = true;
        node.on('input', (msg) => {
            const isTooOften = checkIfTooOften();
            lastCall_ms = Date.now();
            if (isTooOften) {
                node.error('Emit cancelled, the node called TOO often!');
                return;
            }
            const currentTags = tagStorage.setStorage(parentPath);
            if (msg.deleteTag) {
                msg.topic = msg.topic != null ? msg.topic.toString() : '';
                const deletedTagId = tagStorage.deleteTag(msg.topic, parentPath);
                if (deletedTagId) {
                    node.warn(`Tag '${parentPath}/${msg.topic}' DELETED`);
                    node.status({ text: `DELETED: ${msg.topic}`, fill: 'green', shape: 'dot' });
                }
                else {
                    node.warn(`Tag '${parentPath}/${msg.topic}' NOT FOUND`);
                    node.status({ text: `NOT FOUND: ${msg.topic}`, fill: 'red', shape: 'dot' });
                }
                return;
            }
            if (msg.toJSON === true) {
                const storageCopy = {};
                const tagNames = Object.keys(currentTags);
                for (const tagName of tagNames) {
                    storageCopy[tagName] = {};
                    storageCopy[tagName].desc = currentTags[tagName].desc || '';
                    storageCopy[tagName].db = currentTags[tagName].db || 0;
                    storageCopy[tagName].value = currentTags[tagName].value;
                }
                const payload = JSON.stringify(storageCopy);
                const length = Object.keys(currentTags).length;
                node.status({ text: `${length} tags exported`, fill: 'green', shape: 'dot' });
                return node.send({ topic: 'toJSON', payload });
            }
            if (msg.toMetrics === true) {
                const spBMetrics = {
                    timestamp: Date.now(),
                    metrics: [],
                };
                const tagNames = Object.keys(currentTags);
                for (const tagName of tagNames) {
                    const value = currentTags[tagName].value;
                    const props = currentTags[tagName].props ? currentTags[tagName].props : {};
                    const dataType = (props.dataType) ? props.dataType : getSpBDataType(value);
                    const metric = {
                        name: tagName,
                        value,
                        dataType,
                    };
                    spBMetrics.metrics.push(metric);
                }
                const length = spBMetrics.metrics.length;
                node.status({ text: `${length} metrics sent`, fill: 'green', shape: 'dot' });
                return node.send({ topic: 'toMetrics', payload: spBMetrics });
            }
            if (msg.setProperties === true) {
                if (!isObject(msg.payload))
                    return node.error('.payload must be and an object type, got '
                        + (msg.payload ? typeof msg.payload : "'null'"));
                const tagNames = Object.keys(msg.payload);
                for (const tagName of tagNames) {
                    const path = msg.payload[tagName] && msg.payload[tagName].path
                        ? msg.payload[tagName].path : parentPath;
                    const tag = addTagIfNotExist(tagName, path, tagStorage);
                    const tagDef = msg.payload[tagName];
                    if (tagDef.desc && typeof tagDef.desc === 'string')
                        tag.desc = tagDef.desc;
                    if (tagDef.db && typeof tagDef.db === 'number')
                        tag.db = tagDef.db;
                    if (tagDef.props && typeof tagDef.props === 'object')
                        tag.props = tagDef.props;
                }
                const tagDefQty = Object.keys(msg.payload).length;
                node.status({ text: `${tagDefQty} properties set`, fill: 'green', shape: 'dot' });
                node.warn(`Added properties for ${tagDefQty} tags.`);
                return;
            }
            const namesOfChangedTags = [];
            if (config.isBatch) {
                if (!isObject(msg.payload))
                    return node.error('.payload must be and an object type, got '
                        + (msg.payload ? typeof msg.payload : "'null'"));
                const newKeys = Object.keys(msg.payload || {});
                if (!newKeys.length)
                    return;
                for (const key of newKeys) {
                    const tagName = key;
                    const newValue = msg.payload[key];
                    const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath, tagStorage);
                    if (changedTag)
                        namesOfChangedTags.push(changedTag.name);
                }
                if (namesOfChangedTags.length || isFirstCall)
                    node.status({ text: namesOfChangedTags.length + ' tag(s) in', fill: 'grey', shape: 'dot' });
            }
            else {
                const tagName = config.tagName || msg.topic;
                if (!tagName || typeof tagName !== 'string') {
                    node.error('Invalid Tag Name: ' + JSON.stringify(tagName));
                    return;
                }
                if (msg.payload == null)
                    return;
                const newValue = msg.payload;
                const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath, tagStorage, config.isForcedEmit);
                if (!changedTag && !isFirstCall)
                    return;
                if (changedTag)
                    namesOfChangedTags.push(changedTag.name);
                if (typeof msg.desc === 'string')
                    currentTags[tagName].desc = msg.desc;
                else if (config.desc)
                    currentTags[tagName].desc = config.desc;
                if (typeof msg.db === 'number' && Number.isFinite(msg.db))
                    currentTags[tagName].db = msg.db;
                else if (config.deadband) {
                    const db = Number.parseFloat(config.deadband);
                    currentTags[tagName].db = Number.isFinite(db) ? db : 0;
                }
                if (namesOfChangedTags.length || isFirstCall) {
                    const text = newValueToString(newValue);
                    node.status({ text, fill: 'grey', shape: 'dot' });
                }
            }
            isFirstCall = false;
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
            CxTagEmitter.emitTagValueChange(namesOfChangedTags, parentPath, tagStorage.name);
        });
    }
}
CxTagEmitter.tagStorages = {};
exports.default = CxTagEmitter;
function addTagIfNotExist(tagId, path, tagStorage) {
    const tagFromStore = tagStorage.getTag(tagId, path);
    const now = Date.now();
    const tag = tagFromStore
        || {
            name: tagId,
            value: null,
            prevValue: null,
            ts: now,
            prevTs: undefined,
        };
    if (!tagFromStore)
        tagStorage.setTag(tag, path);
    return tag;
}
function setNewTagValueIfChanged(tagId, newValue, path, tagStorage, isForcedEmit) {
    if (typeof newValue === 'function')
        return;
    const tag = addTagIfNotExist(tagId, path, tagStorage);
    const currentValue = tag.value;
    if (isDifferent(newValue, currentValue)) {
        if (tag.db && typeof newValue === 'number' && typeof currentValue === 'number') {
            const diff = Math.abs(newValue - currentValue);
            if (diff < tag.db) {
                return;
            }
        }
        tag.prevValue = tag.value;
        tag.value = newValue;
        tag.prevTs = tag.ts;
        tag.ts = Date.now();
        return tag;
    }
    else if (isForcedEmit) {
        tag.prevTs = tag.ts;
        tag.ts = Date.now();
        return tag;
    }
}
function checkIfTooOften() {
    if (Date.now() - lastCall_ms < 50) {
        at10msCounter += 1;
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
function groupByPath(tagConfigs, tagStorage) {
    const payload = {};
    for (const tagConfig of tagConfigs) {
        const path = tagConfig.path || exports.ROOT_STORAGE_PATH;
        const tag = tagStorage.getTag(tagConfig.name, path);
        if (!tag)
            continue;
        if (!payload[path])
            payload[path] = {};
        payload[path][tag.name] = tag.value;
    }
    return payload;
}
function isDifferent(newValue, oldValue) {
    if (oldValue == null && newValue != null) {
        return true;
    }
    else if (typeof newValue === 'object' && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        return true;
    }
    else if (typeof newValue !== 'object' && oldValue !== newValue) {
        return true;
    }
    return false;
}
function isObject(obj) {
    return !!obj && obj.constructor.name === 'Object';
}
function getSpBDataType(value) {
    switch (typeof value) {
        case 'boolean':
            return 'Boolean';
        case 'number': {
            if (Number.isInteger(value))
                return 'Int64';
            else
                return 'Double';
        }
        case 'string':
            return 'String';
    }
    return 'Unknown';
}
function newValueToString(newValue) {
    if (newValue == null)
        return '';
    let valueStr = newValue.toString();
    if (typeof newValue === 'object') {
        if (Array.isArray(newValue)) {
            valueStr = 'Array: ' + (newValue).length + ' items';
        }
        else {
            valueStr = 'Object: ' + Object.keys(newValue).length + ' props';
        }
    }
    if (valueStr.length > MAX_CHARACTERS_IN_TAG_VALUE) {
        valueStr = valueStr.slice(0, MAX_CHARACTERS_IN_TAG_VALUE) + '...';
    }
    return valueStr;
}
//# sourceMappingURL=cx_tag_emitter.js.map