import { Node, NodeAPI, NodeDef } from 'node-red';
import { EventEmitter } from 'events';


const MAX_CHARACTERS_IN_TAG_VALUE = 18;
const ALL_CHANGES_CHANNEL = '__ALL_CHANGES__';
const eventEmitter =  new EventEmitter();

let lastCall_ms = 0;
let at10msCounter = 0;
const tagListenerCounter: {[tag: string]: number} = {};
export const TAGS_STORAGE = '_TAGS_';
export const ROOT_STORAGE_PATH = '[root]';
export const DEFAULT_TAGS_STORAGE = 'default';

/**
 * Important: do not use Tag class as it saved to JSON.
 *   After parsing it from FS context it's losing all their methods.
 */
export interface Tag {
    prevTs?: number;
    value: any,
    prevValue: any,
    name: string,
    // sourceNodeId: string,
    props?: {[key: string]: any};
    desc?: string;
    db?: number; // deadband
    ts: number
}

export interface ITagInNodeConfig extends NodeDef {
    isForcedEmit?: boolean;
    storage: string, // storage config node ID
    path: string;
    name: string,
    isBatch: boolean,
    tagName?: string,
    dType?: string,
    desc?: string,
    deadband?: string
}

export interface ITagEmitConfig {
    name: string,
    isAdded?: boolean,
    path?: string
}

export interface IValueEmitterConfig extends NodeDef {
    isGrouped?: boolean;
    tags?: ITagEmitConfig[];
    storage: string, // storage config node ID
    path: string;
    addedTagName: string;
    name: string,
    tagName: string | number,
    emitOnStart: boolean,
    isToEmitAllChanges: boolean,
}

export interface IStorageManagerConfig extends NodeDef {
    name: string,
    storeName: string,
    paths: {[key: string]: string[]}
}

export interface ITagStorage {
    [tagName: string]: Tag,
}

export interface ITagStoragePath {
    [path: string]: ITagStorage,
}

export interface ITagNameValueObject {
    [tagName: string]: any
}

export interface GroupedByPathPayload {
    [path: string]: ITagNameValueObject
}

export class TagStorage {
    storage: ITagStoragePath = {
        [ROOT_STORAGE_PATH]: {},
    };

    get name() {
        return this.storeName || '';
    }

    static getStoragesByGlobalContext(node: Node, storageName: string): ITagStoragePath {
        const _storeName = storageName === DEFAULT_TAGS_STORAGE ? undefined : storageName;
        const storage = node
            .context()
            .global
            .get(TAGS_STORAGE, _storeName) as ITagStoragePath | undefined;

        return storage || {};
    }

    constructor(private node: Node, private readonly storeName?: string) {
        const _storeName = this.storeName === DEFAULT_TAGS_STORAGE ? undefined : this.storeName;
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
                .set(TAGS_STORAGE, this.storage, _storeName);
        }
    }

    setContext() {
        const _storeName = this.storeName === DEFAULT_TAGS_STORAGE ? undefined : this.storeName;
        this.node.context().global.set(TAGS_STORAGE, this.storage, _storeName);
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

        // create path in the storage if not exist
        if (!this.storage[path]) this.storage[path] = {};

        this.storage[path][tag.name] = tag;
        this.setContext();
        return tag;
    }

    getNameValueObject(tagIdList: string[], path: string): ITagNameValueObject {
        path = path || ROOT_STORAGE_PATH;
        const out: ITagNameValueObject = {};
        const storage = this.storage[path];
        if (!storage) return out;

        for (const tagId of tagIdList) {
            const tag = storage[tagId];
            // eslint-disable-next-line no-continue
            if (!tag) continue;
            out[tag.name] = tag.value;
        }
        return out;
    }

    getNameValueObjectFromTagConfigs(tagConfigsList: ITagEmitConfig[]): ITagNameValueObject {
        const out: ITagNameValueObject = {};
        for (const tagConf of tagConfigsList) {
            const storage = this.storage[tagConf.path || ''];
            // eslint-disable-next-line no-continue
            if (!storage) continue;
            const tag = storage[tagConf.name];
            // eslint-disable-next-line no-continue
            if (!tag) continue;
            out[tag.name] = tag.value;
        }
        return out;
    }

    deleteTag(tagId: string, path: string): string | undefined {
        path = path || ROOT_STORAGE_PATH;
        const storage = this.storage[path];
        const tag = storage ? storage[tagId] : null;

        if (tag && storage) {
            delete storage[tagId];
            return tagId;
        }
    }
}

export interface IStorageManagerNode extends Node<object> {
    tagStorage?: TagStorage
}

export interface ITagSubConf {
    name: string,
    path?: string,
    storageName?: string,
}

export default class CxTagEmitter {
    static RED: NodeAPI;
    private static tagStorages: {[key: string]: TagStorage} = {};
    static getAbsolutePath(tagStorageModule: string, parentPath: string | undefined, tagName: string) {
        parentPath = parentPath || ROOT_STORAGE_PATH;
        return tagStorageModule + '/' + parentPath + '/' + tagName;
    }

    static subscribeToTagChanges(
        tagStorageModule: string,
        parentPath: string,
        tagName: string,
        cb: (tag: Tag, subConf: ITagSubConf) => void,
    ): (() => void) {
        const tagStorage = CxTagEmitter.tagStorages[tagStorageModule];

        const tagAbsPath = CxTagEmitter.getAbsolutePath(tagStorageModule, parentPath, tagName);
        const callback = (tagConf: ITagEmitConfig) => {
            const tagPath1 = tagConf.path || '';
            const tag = tagStorage.getTag(tagConf.name, tagPath1);

            if (tag) cb(tag, { name: tagConf.name, path: tagPath1, storageName: tagStorageModule });
        };
        eventEmitter.on(tagAbsPath, callback);

        return () => eventEmitter.removeListener(tagAbsPath, callback);
    }

    static subToChange(tagSubConfs: ITagSubConf[], cb: (tag: Tag, subConf: ITagSubConf) => void) {
        const unsubscribers: (() => void)[] = [];
        for (const conf of tagSubConfs) {
            const storeName = conf.storageName || DEFAULT_TAGS_STORAGE;
            const path = conf.path || ROOT_STORAGE_PATH;
            unsubscribers.push(CxTagEmitter.subscribeToTagChanges(storeName, path, conf.name, cb));
        }
        return unsubscribers;
    }

    static emitTagValueChange(namesOfChangedTags: string[], parentPath?: string, tagStorageModule?: string) {
        tagStorageModule = tagStorageModule || DEFAULT_TAGS_STORAGE;
        parentPath = parentPath || ROOT_STORAGE_PATH;

        for (const changedTagName of namesOfChangedTags) {
            // eslint-disable-next-line no-continue
            if (changedTagName == null) continue;

            const tagConfig: ITagEmitConfig = { path: parentPath, name: changedTagName };
            const tagAbsPath = CxTagEmitter.getAbsolutePath(tagStorageModule, parentPath, changedTagName);
            eventEmitter.emit(tagAbsPath, tagConfig);
        }
        const allTagsAbsPath = CxTagEmitter.getAbsolutePath(tagStorageModule, parentPath, ALL_CHANGES_CHANNEL);
        eventEmitter.emit(allTagsAbsPath, namesOfChangedTags);
    }


    static setTag(tagName: string, newValue: any, parentPath?: string, tagStorageModule?: string) {
        tagStorageModule = tagStorageModule || DEFAULT_TAGS_STORAGE;
        parentPath = parentPath || ROOT_STORAGE_PATH;

        const tagStorage = CxTagEmitter.tagStorages[tagStorageModule];
        const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath, tagStorage);
        if (!changedTag) return;

        CxTagEmitter.emitTagValueChange([changedTag.name], parentPath, tagStorageModule);
    }

    static getTag(tagName: string, parentPath?: string, tagStorageModule?: string): Tag | undefined {
        tagStorageModule = tagStorageModule || DEFAULT_TAGS_STORAGE;
        parentPath = parentPath || ROOT_STORAGE_PATH;

        const tagStorage = CxTagEmitter.tagStorages[tagStorageModule];
        const tag = tagStorage?.getTag(tagName, parentPath);
        return tag;
    }

    static storageConfig(config: IStorageManagerConfig, node: IStorageManagerNode) {
        node.tagStorage = new TagStorage(node, config.storeName);
        CxTagEmitter.tagStorages[config.storeName] = node.tagStorage;
        const intervalId = setInterval(() => node.tagStorage?.setContext(), 1000);

        node.on('close', () => clearInterval(intervalId));

        // below is to attach custom function to the RED body
        // the function is getting reference of the tag. This can help get tags in Node RED functions
        // @ts-ignore
        if (CxTagEmitter.RED.util.cxGetTag) return;
        // @ts-ignore
        CxTagEmitter.RED.util.cxGetTag = function (tagName?: any, path?: any, storageName?: any) {
            if (!tagName) return;

            storageName = (!storageName || typeof storageName !== 'string') ? DEFAULT_TAGS_STORAGE : storageName;
            const storage = TagStorage.getStoragesByGlobalContext(node, storageName);

            path = (!path || typeof path !== 'string') ? ROOT_STORAGE_PATH : path;
            const container = storage[path];

            if (!container) return;

            return container[tagName];
        };
    }


    static valueEmitter(config: IValueEmitterConfig, node: Node) {
        // get storage node ID from the config
        const configNodeId = config.storage;
        const configNode: IStorageManagerNode = CxTagEmitter.RED.nodes.getNode(configNodeId);
        if (!configNode || !configNode.tagStorage) return node.error('Select Storage Node and its context name');

        if (typeof config.path !== 'string' || !config.path) return node.error('Tags path must be defined');

        const tagStorage = configNode.tagStorage;

        // fixing MaxListenersExceededWarning
        // Looking after RED.events max listeners: adding max listeners number one by one
        if (config.emitOnStart) {
            const listenerCounts = CxTagEmitter.RED.events.getMaxListeners() + 1;
            CxTagEmitter.RED.events.setMaxListeners(listenerCounts);
        }

        node.status({ fill: 'grey', shape: 'ring' });
        node.on('input', emitCurrentTags);

        let isError = false;

        if (config.isToEmitAllChanges) {
            //
            // ============= This is if ALL tag changes emitted ==============
            //
            const allTagsAbsPath = CxTagEmitter.getAbsolutePath(tagStorage.name, config.path, ALL_CHANGES_CHANNEL);
            eventEmitter.on(allTagsAbsPath, handleAnyTagChange);
            if (config.emitOnStart) CxTagEmitter.RED.events.on('flows:started', emitOnStart);

            node.status({ fill: 'grey', shape: 'dot', text: 'from: ' + config.path });

            node.on('close', () => {
                eventEmitter.removeListener(allTagsAbsPath, handleAnyTagChange);
            });

            return;
        }

        //
        // ============= This is if SOME or ONE tag changes emitted ==============
        //
        if (!Array.isArray(config.tags) || !config.tags.length) {
            node.error('Tag Names are not provided');
            return;
        }

        // split by comma, trim and remove empty results
        const tagConfigs: ITagEmitConfig[] = config.tags.filter(tagConf => !!tagConf.name);

        // don't bother going further if no tags selected
        if (!tagConfigs.length) return;

        const addedTags = tagConfigs.filter(tagConf => tagConf.isAdded);
        const emittedTags = tagConfigs.filter(tagConf => !tagConf.isAdded);
        const isOnlyOneTagToEmit = emittedTags.length === 1 && !addedTags.length;

        let batchQty = 0;

        for (const tag of emittedTags) {
            const tagAbsPath = CxTagEmitter.getAbsolutePath(tagStorage.name, tag.path, tag.name);
            eventEmitter.on(tagAbsPath, handleSomeTagChanges);

            // fixing MaxListenersExceededWarning
            if (!tagListenerCounter[tag.name]) tagListenerCounter[tag.name] = 0;
            tagListenerCounter[tag.name] += 1;
        }

        const max = Math.max(...Object.values(tagListenerCounter));
        eventEmitter.setMaxListeners(max + 10);


        if (config.emitOnStart) CxTagEmitter.RED.events.on('flows:started', emitOnStart);

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

            // Looking after RED.events max listeners: subtracting max listeners number one by one
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
                } else handleError();

                handleAnyTagChange(Object.keys(currentTags));

            } else if (emittedTags) {
                emittedTags.forEach(handleSomeTagChanges);
            }
        }

        function handleSomeTagChanges(tagConf: ITagEmitConfig) {
            const tagPath = tagConf.path || '';
            const tag = tagStorage.getTag(tagConf.name, tagPath);
            if (!tag) return;

            if (isOnlyOneTagToEmit) {
                const text = newValueToString(tag.value);
                node.status({ text, fill: 'grey', shape: 'dot' });

                const additionalProps: any = { prevValue: tag.prevValue };
                if (tag.props) additionalProps.props = tag.props;
                node.send(buildMessage(tagConf.name, tag.value, tagPath, additionalProps));
                return;
            }


            // When config.tagName has multiple tags (e.g. STRING_TAG_1, NUMBER_TAG_1,BOOLEAN_TAG_1)
            // the node EMITS multiple times (e.g. 3 times)
            // Solution is to send the BATCH in this JS Loop, prevent from sending and let in the next JS loop
            batchQty += 1;
            if (batchQty > 1) return;

            // remove batchQty flag in the next JS loop
            setTimeout(() => {

                const payload = config.isGrouped
                    ? groupByPath(tagConfigs, tagStorage)
                    : tagStorage.getNameValueObjectFromTagConfigs(tagConfigs);

                node.send(buildMessage('__some', payload));

                node.status({ text: batchQty + ' change(s)', fill: 'grey', shape: 'dot' });
                batchQty = 0;
            }, 0);
        }

        function handleAnyTagChange(idListOfChangedTagValues: string[]) {
            const parentPath = config.path;
            const payload: {[key: string]: any} = tagStorage.getNameValueObject(idListOfChangedTagValues, parentPath);

            if (!Object.keys(payload).length) return handleError('Nothing to emit');
            else handleError();

            node.send(buildMessage('__all', payload, parentPath));
        }

        function buildMessage(topic: string, payload: any, path?: string, additionalProps?: {[key: string]: any}) {
            additionalProps = additionalProps || {};
            return {
                ...additionalProps,
                topic,
                payload,
                path,
                storage: tagStorage.name,
            };
        }

        function handleError(text?: string) {
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

    static tagsIn(config: ITagInNodeConfig, node: Node) {

        // get storage node ID from the config
        const configNodeId = config.storage;
        const configNode: IStorageManagerNode = CxTagEmitter.RED.nodes.getNode(configNodeId);
        if (!configNode || !configNode.tagStorage) return node.error("Config 'tag-storage' node must be selected");

        if (typeof config.path !== 'string' || !config.path) return node.error('Tags path must be defined');

        const parentPath = config.path;
        const tagStorage = configNode.tagStorage;
        node.status({ fill: 'grey', shape: 'ring' });

        let isFirstCall = true;
        node.on('input', (msg: any) => {

            const isTooOften = checkIfTooOften();
            lastCall_ms = Date.now();
            if (isTooOften) {
                node.error('Emit cancelled, the node called TOO often!');
                return;
            }

            const currentTags: ITagStorage = tagStorage.setStorage(parentPath);

            if (msg.deleteTag) {
                msg.topic = msg.topic != null ? msg.topic.toString() : '';
                const deletedTagId = tagStorage.deleteTag(msg.topic, parentPath);
                if (deletedTagId) {
                    node.warn(`Tag '${parentPath}/${msg.topic}' DELETED`);
                    node.status({ text: `DELETED: ${msg.topic}`, fill: 'green', shape: 'dot' });
                } else {
                    node.warn(`Tag '${parentPath}/${msg.topic}' NOT FOUND`);
                    node.status({ text: `NOT FOUND: ${msg.topic}`, fill: 'red', shape: 'dot' });
                }
                return;
            }

            if (msg.toJSON === true) {
                const storageCopy: {[tag: string]: any} = {};

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
                const spBMetrics: {[key: string]: any} = {
                    timestamp: Date.now(),
                    metrics: [],
                };
                const tagNames = Object.keys(currentTags);
                for (const tagName of tagNames) {
                    const value = currentTags[tagName].value;
                    const props: any = currentTags[tagName].props ? currentTags[tagName].props : {};
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
                if (!isObject(msg.payload)) return node.error('.payload must be and an object type, got '
                        + (msg.payload ? typeof msg.payload : "'null'"));

                const tagNames = Object.keys(msg.payload);
                for (const tagName of tagNames) {
                    const path = msg.payload[tagName] && msg.payload[tagName].path
                        ? msg.payload[tagName].path : parentPath;
                    const tag = addTagIfNotExist(tagName, path, tagStorage);
                    const tagDef = msg.payload[tagName];
                    if (tagDef.desc && typeof tagDef.desc === 'string') tag.desc = tagDef.desc;
                    if (tagDef.db && typeof tagDef.db === 'number') tag.db = tagDef.db;
                    if (tagDef.props && typeof tagDef.props === 'object') tag.props = tagDef.props;
                }

                const tagDefQty = Object.keys(msg.payload).length;
                node.status({ text: `${tagDefQty} properties set`, fill: 'green', shape: 'dot' });
                node.warn(`Added properties for ${tagDefQty} tags.`);
                return;
            }


            const namesOfChangedTags: string[] = [];

            if (config.isBatch) {

                // this is then BATCH Tag IN

                if (!isObject(msg.payload)) return node.error('.payload must be and an object type, got '
                        + (msg.payload ? typeof msg.payload : "'null'"));

                const newKeys = Object.keys(msg.payload || {});
                if (!newKeys.length) return;

                for (const key of newKeys) {
                    const tagName = key;
                    const newValue = msg.payload[key];
                    const changedTag = setNewTagValueIfChanged(tagName, newValue, parentPath, tagStorage);
                    if (changedTag) namesOfChangedTags.push(changedTag.name);
                }

                if (namesOfChangedTags.length || isFirstCall) node.status({ text: namesOfChangedTags.length + ' tag(s) in', fill: 'grey', shape: 'dot' });
            } else {

                // this is then SINGLE Tag IN

                const tagName = config.tagName || msg.topic;
                if (!tagName || typeof tagName !== 'string') {
                    node.error('Invalid Tag Name: ' + JSON.stringify(tagName));
                    return;
                }

                if (msg.payload == null) return;


                // prepare the tag
                const newValue = msg.payload;
                const changedTag = setNewTagValueIfChanged(
                    tagName,
                    newValue,
                    parentPath,
                    tagStorage,
                    config.isForcedEmit,
                );
                if (!changedTag  && !isFirstCall) return;

                if (changedTag) namesOfChangedTags.push(changedTag.name);

                // override config description with the incoming message .desc property
                if (typeof msg.desc === 'string') currentTags[tagName].desc = msg.desc;
                else if (config.desc) currentTags[tagName].desc = config.desc;


                if (typeof msg.db === 'number' && Number.isFinite(msg.db)) currentTags[tagName].db = msg.db;
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

            CxTagEmitter.emitTagValueChange(namesOfChangedTags, parentPath, tagStorage.name);
        });


    }
}

function addTagIfNotExist(tagId: string, path: string, tagStorage: TagStorage): Tag {
    const tagFromStore = tagStorage.getTag(tagId, path);
    const now = Date.now();
    const tag = tagFromStore
        || {
            name: tagId,
            // sourceNodeId: node.id,
            value: null,
            prevValue: null,
            ts: now,
            prevTs: undefined,
        };

    if (!tagFromStore) tagStorage.setTag(tag, path);
    return tag;
}

// returns Tag if changed
function setNewTagValueIfChanged(
    tagId: string,
    newValue: any,
    path: string,
    tagStorage: TagStorage,
    isForcedEmit?: boolean,
): Tag | undefined {
    if (typeof newValue === 'function') return;

    const tag = addTagIfNotExist(tagId, path, tagStorage);

    const currentValue = tag.value;
    if (isDifferent(newValue, currentValue)) {
        // if (tag.sourceNodeId && tag.sourceNodeId !== node.id) {
        //     node.warn(`Tag ${tagId} changed by two different sources. ` +
        //         `From ${tag.sourceNodeId} to ${node.id}`);
        //     tag.sourceNodeId = node.id;
        // }

        // check if out of the deadband, if not return
        if (tag.db && typeof newValue === 'number' && typeof currentValue === 'number') {
            const diff = Math.abs(newValue - currentValue);
            if (diff < tag.db) {
                // if (isDebug) console.log(`diff [${diff}] is smaller than deadband [${tag.db}]`)
                return;
            }
        }


        // save new and previous value to the Tag Instance
        tag.prevValue = tag.value;
        tag.value = newValue;
        tag.prevTs = tag.ts;
        tag.ts = Date.now();
        return tag;
    } else if (isForcedEmit) {
        tag.prevTs = tag.ts;
        tag.ts = Date.now();
        return tag;
    }
}

function checkIfTooOften() {
    if (Date.now() - lastCall_ms < 50) {
        at10msCounter += 1;
    } else {
        at10msCounter = 0;
        return false;
    }

    const at10msFor100times = at10msCounter >= 100;
    // clamp counter if the function is kept called;
    if (at10msFor100times) at10msCounter = 100;
    return at10msFor100times;
}

function groupByPath(tagConfigs: ITagEmitConfig[], tagStorage: TagStorage): GroupedByPathPayload {
    const payload: GroupedByPathPayload = {};

    for (const tagConfig of tagConfigs) {
        const path = tagConfig.path || ROOT_STORAGE_PATH;

        const tag = tagStorage.getTag(tagConfig.name, path);
        // eslint-disable-next-line no-continue
        if (!tag) continue;

        if (!payload[path]) payload[path] = {};
        payload[path][tag.name] = tag.value;
    }

    return payload;
}

function isDifferent(newValue: any, oldValue: any): boolean {
    if (oldValue == null && newValue != null) {
        return true;
    } else if (typeof newValue === 'object' && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        return true;
    } else if (typeof newValue !== 'object' && oldValue !== newValue) {
        return true;
    }
    return false;
}

function isObject(obj: any): boolean {
    // OLD way: return !(obj == null || Array.isArray(obj) || typeof obj !== "object")
    return !!obj && obj.constructor.name === 'Object';
}

function getSpBDataType(value: any): string {
    switch (typeof value) {
        case 'boolean':
            return 'Boolean';
        case 'number': {
            if (Number.isInteger(value)) return 'Int64';
            else return 'Double';
        }
        case 'string':
            return 'String';
    }
    return 'Unknown';
}

function newValueToString(newValue: any): string {
    if (newValue == null) return '';
    let valueStr = newValue.toString();
    if (typeof newValue === 'object') {
        if (Array.isArray(newValue)) {
            valueStr = 'Array: ' + (newValue).length + ' items';
        } else {
            valueStr = 'Object: ' + Object.keys(newValue as object).length + ' props';
        }
    }

    if (valueStr.length > MAX_CHARACTERS_IN_TAG_VALUE) {
        valueStr = valueStr.slice(0, MAX_CHARACTERS_IN_TAG_VALUE) + '...';
    }

    return valueStr;
}
