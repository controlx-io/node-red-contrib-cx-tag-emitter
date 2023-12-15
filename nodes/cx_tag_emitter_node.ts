import { Node, NodeAPI } from 'node-red';
import CxTagEmitter, {
    IStorageManagerConfig,
    IStorageManagerNode, ITagInNodeConfig, IValueEmitterConfig,
    ROOT_STORAGE_PATH,
    TagStorage,
} from './cx_tag_emitter';

const isDebug = !!process.env['TAG_EMITTER_NODE'];
const isTesting = !!process.env['CX_MOCHA_TESTING'];

module.exports = function CxTagEmitterNode(RED: NodeAPI) {
    CxTagEmitter.RED = RED;

    const redContextStorage = isTesting ? {} : RED.settings.get('contextStorage');
    const storages = redContextStorage ? Object.keys(redContextStorage) : [];
    if (!storages.includes('default')) storages.unshift('default');

    RED.httpAdmin.get('/__cx_tag_emitter/get_storages', (req, res) => {
        res.json(storages).end();
    });


    RED.httpAdmin.get('/__cx_tag_emitter/get_paths', (req, res) => {
        const configNodeId = req.query['config_node_id'] as string;
        const storageName = req.query['storage_name'] as string;
        const isStats = req.query['stats'] === 'true';

        const configNode: IStorageManagerNode | undefined = RED.nodes.getNode(configNodeId);

        if (!configNodeId || !configNode || !configNode.tagStorage) {
            if (isDebug) console.log('Something wrong, there is no config node:', configNode);
            return res.json([ROOT_STORAGE_PATH]).end();
        }

        const storage = (storageName)
            ? TagStorage.getStoragesByGlobalContext(configNode, storageName)
            : configNode.tagStorage.storage;

        const paths = Object.keys(storage);

        paths.sort();
        if (!isStats) return res.json(paths).end();

        const pathsAndStats = paths.map(path => {
            return [path, {
                tagQty: Object.keys(storage[path]).length,
            }];
        });
        res.json(pathsAndStats).end();
    });


    RED.httpAdmin.get('/__cx_tag_emitter/get_variables', (req, res) => {
        const configNodeId = req.query['config_node_id'] as string;
        const parentPath = req.query['parent_path'] as string;

        if (isDebug) console.log('GET get_variables:', { configNodeId, parentPath });

        const configNode: IStorageManagerNode | undefined = RED.nodes.getNode(configNodeId);

        if (!configNodeId || !parentPath || !configNode || !configNode.tagStorage) {
            if (isDebug) console.log('Something wrong, there is no config node:', configNode);
            return res.json([]).end();
        }

        const currentTags = configNode.tagStorage.getStorage(parentPath);
        if (!currentTags) return res.json([]).end();

        const tagNames: string[] = Object.keys(currentTags);
        tagNames.sort();

        const values: {[tagName: string]: any} = {};
        const descriptions: {[tagName: string]: string | undefined} = {};
        for (const tag of tagNames) {
            // eslint-disable-next-line no-continue
            if (!currentTags[tag]) continue;

            values[tag] = currentTags[tag].value;
            if (currentTags[tag].desc) descriptions[tag] = currentTags[tag].desc;
        }

        res.json([tagNames, values, descriptions]).end();
    });


    RED.httpAdmin.post('/__cx_tag_emitter/emit_request/:id', (req, res) => {
        // @ts-ignore
        const node = RED.nodes.getNode(req.params.id);
        if (node != null) {
            try {
                node.receive();
                res.sendStatus(200);
            } catch (err) {
                res.sendStatus(500);
                node.error('Failed to Emit on button');
            }
        } else {
            res.sendStatus(404);
        }
    });

    function StorageConfig(config: IStorageManagerConfig) {
        RED.nodes.createNode(this, config);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const node: IStorageManagerNode = this;

        CxTagEmitter.storageConfig(config, node);
    }

    function ValueEmitter(config: IValueEmitterConfig) {
        RED.nodes.createNode(this, config);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const node: Node = this;

        CxTagEmitter.valueEmitter(config, node);
    }

    function TagsIn(config: ITagInNodeConfig) {
        RED.nodes.createNode(this, config);
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const node: Node = this;

        CxTagEmitter.tagsIn(config, node);
    }


    RED.nodes.registerType('tag-storage', StorageConfig);
    RED.nodes.registerType('value_emitter', ValueEmitter);
    RED.nodes.registerType('tags_in', TagsIn);
};
