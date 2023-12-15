"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const cx_tag_emitter_1 = __importStar(require("./cx_tag_emitter"));
const isDebug = !!process.env['TAG_EMITTER_NODE'];
const isTesting = !!process.env['CX_MOCHA_TESTING'];
module.exports = function CxTagEmitterNode(RED) {
    cx_tag_emitter_1.default.RED = RED;
    const redContextStorage = isTesting ? {} : RED.settings.get('contextStorage');
    const storages = redContextStorage ? Object.keys(redContextStorage) : [];
    if (!storages.includes('default'))
        storages.unshift('default');
    RED.httpAdmin.get('/__cx_tag_emitter/get_storages', (req, res) => {
        res.json(storages).end();
    });
    RED.httpAdmin.get('/__cx_tag_emitter/get_paths', (req, res) => {
        const configNodeId = req.query['config_node_id'];
        const storageName = req.query['storage_name'];
        const isStats = req.query['stats'] === 'true';
        const configNode = RED.nodes.getNode(configNodeId);
        if (!configNodeId || !configNode || !configNode.tagStorage) {
            if (isDebug)
                console.log('Something wrong, there is no config node:', configNode);
            return res.json([cx_tag_emitter_1.ROOT_STORAGE_PATH]).end();
        }
        const storage = (storageName)
            ? cx_tag_emitter_1.TagStorage.getStoragesByGlobalContext(configNode, storageName)
            : configNode.tagStorage.storage;
        const paths = Object.keys(storage);
        paths.sort();
        if (!isStats)
            return res.json(paths).end();
        const pathsAndStats = paths.map(path => {
            return [path, {
                    tagQty: Object.keys(storage[path]).length,
                }];
        });
        res.json(pathsAndStats).end();
    });
    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', (req, res) => {
        const configNodeId = req.query['config_node_id'];
        const parentPath = req.query['parent_path'];
        if (isDebug)
            console.log('GET get_variables:', { configNodeId, parentPath });
        const configNode = RED.nodes.getNode(configNodeId);
        if (!configNodeId || !parentPath || !configNode || !configNode.tagStorage) {
            if (isDebug)
                console.log('Something wrong, there is no config node:', configNode);
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
    RED.httpAdmin.post('/__cx_tag_emitter/emit_request/:id', (req, res) => {
        const node = RED.nodes.getNode(req.params.id);
        if (node != null) {
            try {
                node.receive();
                res.sendStatus(200);
            }
            catch (err) {
                res.sendStatus(500);
                node.error('Failed to Emit on button');
            }
        }
        else {
            res.sendStatus(404);
        }
    });
    function StorageConfig(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        cx_tag_emitter_1.default.storageConfig(config, node);
    }
    function ValueEmitter(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        cx_tag_emitter_1.default.valueEmitter(config, node);
    }
    function TagsIn(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        cx_tag_emitter_1.default.tagsIn(config, node);
    }
    RED.nodes.registerType('tag-storage', StorageConfig);
    RED.nodes.registerType('value_emitter', ValueEmitter);
    RED.nodes.registerType('tags_in', TagsIn);
};
//# sourceMappingURL=cx_tag_emitter_node.js.map