"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_red_node_test_helper_1 = __importDefault(require("node-red-node-test-helper"));
const emitterNode = require("./cx_tag_emitter_node");
node_red_node_test_helper_1.default.init(require.resolve('node-red'), {
    adminAuth: undefined,
    apiMaxLength: undefined,
    credentialSecret: undefined,
    debugMaxLength: undefined,
    debugUseColors: undefined,
    disableEditor: undefined,
    editorTheme: undefined,
    exportGlobalContextKeys: undefined,
    flowFile: undefined,
    flowFilePretty: undefined,
    httpAdminRoot: undefined,
    httpNodeAuth: undefined,
    httpNodeCors: undefined,
    httpNodeMiddleware: undefined,
    httpNodeRoot: undefined,
    httpRequestTimeout: undefined,
    httpRoot: undefined,
    httpServerOptions: undefined,
    httpStatic: undefined,
    httpStaticAuth: undefined,
    https: undefined,
    logging: undefined,
    mqttReconnectTime: undefined,
    nodeMessageBufferMaxLength: undefined,
    nodesDir: undefined,
    paletteCategories: undefined,
    safeMode: undefined,
    serialReconnectTime: undefined,
    socketReconnectTime: undefined,
    socketTimeout: undefined,
    tcpMsgQueueSize: undefined,
    tlsConfigDisableLocalFiles: undefined,
    ui: undefined,
    uiHost: "",
    uiPort: 0,
    userDir: undefined,
    verbose: undefined,
    webSocketNodeVerifyClient: undefined,
    functionGlobalContext: {},
    contextStorage: {
        default: { module: "memory" },
        fs: {
            module: "localfilesystem"
        }
    }
});
describe('Tag Emitter Node', function () {
    beforeEach(function (done) {
        node_red_node_test_helper_1.default.startServer(done);
    });
    afterEach(function (done) {
        node_red_node_test_helper_1.default.unload();
        node_red_node_test_helper_1.default.stopServer(done);
    });
    it('should be loaded', function (done) {
        const flow = [
            standardTagStorageNodeDef(),
            {
                "type": "tags_in",
                "id": "825ce56df6d652e1",
                "z": "c2e510e67fd0b06d",
                "storage": "tag-storage1-id",
                "path": "path-to-something",
                "name": "",
                "isBatch": false,
                "tagName": "this-is-custom-tag-name",
                "desc": "",
                "deadband": "",
                "isForcedEmit": false,
                "wires": [["helper1-id"]]
            },
            { "type": "helper", "id": "helper1-id" }
        ];
        node_red_node_test_helper_1.default.load(emitterNode, flow, function () {
            const tagStorageNode = node_red_node_test_helper_1.default.getNode("tagStorage");
            const tagsInNode = node_red_node_test_helper_1.default.getNode("825ce56df6d652e1");
            const helperNode = node_red_node_test_helper_1.default.getNode("helper1-id");
            let messageNumber = 1;
            helperNode.on("input", function (msg) {
                try {
                    msg.should.have.property('topic', 'this-is-custom-tag-name');
                    if (messageNumber === 1) {
                        msg.should.have.property('payload', 3);
                        msg.should.have.property('prevValue', null);
                        messageNumber = 2;
                    }
                    else {
                        msg.should.have.property('payload', 5);
                        msg.should.have.property('prevValue', 3);
                        done();
                    }
                }
                catch (e) {
                    done(e);
                }
            });
            tagsInNode.receive({ payload: 3 });
            tagsInNode.receive({ payload: 5 });
        });
    });
});
function standardTagStorageNodeDef() {
    return { "type": "tag-storage", "id": "tag-storage1-id", "name": "", "storeName": "fs" };
}
//# sourceMappingURL=cx_tag_emitter_node_spec.js.map