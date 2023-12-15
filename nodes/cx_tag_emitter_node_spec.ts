import helper from "node-red-node-test-helper";
import should from 'should';

const emitterNode = require("./cx_tag_emitter_node");

helper.init(require.resolve('node-red'), {
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
    functionGlobalContext: { },
    contextStorage: {
        default: {module: "memory"},
        fs: {
            module: "localfilesystem"
        }
    }
});

describe('Tag Emitter Node', function () {

    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it('should be loaded', function (done) {
        // const flow = [
        //     { id: "tagStorage", type: "tag-storage", name: "qwe"},
        //     { id: "n1", type: "tags_in", name: "tags_in", wires: [["helperNode"]]},
        //     { id: "helperNode", type: "helper" }
        // ];

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
                // "x": 580,
                // "y": 200,
                "wires": [ ["helper1-id"] ]
            },
            {"type": "helper", "id": "helper1-id"}
        ]

        helper.load(emitterNode, flow, function () {
            const tagStorageNode = helper.getNode("tagStorage");
            const tagsInNode = helper.getNode("825ce56df6d652e1");
            const helperNode = helper.getNode("helper1-id");
            let messageNumber = 1;


            helperNode.on("input", function(msg: any) {
                try {
                    msg.should.have.property('topic', 'this-is-custom-tag-name');
                    if (messageNumber === 1) {

                        msg.should.have.property('payload', 3);
                        msg.should.have.property('prevValue', null);
                        messageNumber = 2;

                    } else {
                        msg.should.have.property('payload', 5);
                        msg.should.have.property('prevValue', 3);
                        done();
                    }
                } catch (e) {
                    done(e);
                }
            })

            // message 1
            tagsInNode.receive({payload: 3});

            // message 2
            tagsInNode.receive({payload: 5});




            // try {
            //
            //
            //     tagStorageNode.should.have.property('name', 'qwe');
            //     tagsInNode.should.have.property('name', 'tags_in');
            //     done();
            // } catch(err) {
            //     done(err);
            // }
        });
    });

    // it('should make payload lower case', function (done) {
    //     var flow = [
    //         { id: "n1", type: "lower-case", name: "lower-case",wires:[["n2"]] },
    //         { id: "n2", type: "helper" }
    //     ];
    //     helper.load(lowerNode, flow, function () {
    //         var n2 = helper.getNode("n2");
    //         var n1 = helper.getNode("n1");
    //         n2.on("input", function (msg: any) {
    //             try {
    //                 msg.should.have.property('payload', 'uppercase');
    //                 done();
    //             } catch(err) {
    //                 done(err);
    //             }
    //         });
    //         n1.receive({ payload: "UpperCase" });
    //     });
    // });
});



function standardTagStorageNodeDef() {
    return {"type": "tag-storage", "id": "tag-storage1-id", "name": "", "storeName": "fs"}
}