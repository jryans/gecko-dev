/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

let { DebuggerServer } =
  Cu.import("resource://gre/modules/devtools/dbg-server.jsm", {});
let { DebuggerClient } =
  Cu.import("resource://gre/modules/devtools/dbg-client.jsm", {});
let { FileUtils } = Cu.import("resource://gre/modules/FileUtils.jsm", {});
let { NetUtil } = Cu.import("resource://gre/modules/NetUtil.jsm", {});
let Pipe = CC("@mozilla.org/pipe;1", "nsIPipe", "init");
let { Promise: promise } = Cu.import("resource://gre/modules/Promise.jsm", {});

function run_test() {
  initTestDebuggerServer();
  add_test_bulk_actor();

  add_task(function() {
    yield test_bulk_transfer_cs(socket_transport, json_reply);
    yield test_bulk_transfer_cs(local_transport, json_reply);
    yield test_bulk_transfer_cs(socket_transport, bulk_reply);
    yield test_bulk_transfer_cs(local_transport, bulk_reply);
    DebuggerServer.destroy();
  });

  run_next_test();
}

/*** Sample Bulk Actor ***/

function TestBulkActor() {}

TestBulkActor.prototype = {

  actorPrefix: "testBulk",

  bulkReply: function({length, copyTo, reply}) {
    do_check_eq(length, really_long().length);
    reply({
      length: length
    }).then(({copyFrom}) => {
      // We'll just echo back the same thing
      let pipe = new Pipe(true, true, 0, 0, null);
      copyTo(pipe.outputStream).then(() => {
        pipe.outputStream.close();
      });
      copyFrom(pipe.inputStream).then(() => {
        pipe.inputStream.close();
      });
    });
  },

  jsonReply: function({length, copyTo, reply}) {
    do_check_eq(length, really_long().length);

    let outputFile = getTestTempFile("bulk-output", true);
    outputFile.create(Ci.nsIFile.NORMAL_FILE_TYPE, parseInt("666", 8));

    let output = FileUtils.openSafeFileOutputStream(outputFile);

    copyTo(output).then(() => {
      FileUtils.closeSafeFileOutputStream(output);
      verify_file_size();
    });

    return {
      allDone: true
    };
  }

};

TestBulkActor.prototype.requestTypes = {
  "bulkReply": TestBulkActor.prototype.bulkReply,
  "jsonReply": TestBulkActor.prototype.jsonReply
};

function add_test_bulk_actor() {
  DebuggerServer.addGlobalActor(TestBulkActor);
}

/*** Tests ***/

function test_bulk_transfer_cs(transportFactory, onReady) {
  do_print("Starting bulk transfer test at " + new Date().toTimeString());

  // Ensure test files are not present from a failed run
  cleanup_files();
  writeTestTempFile("bulk-input", really_long());

  let clientDeferred = promise.defer();
  let serverDeferred = promise.defer();

  let transport = transportFactory();

  let client = new DebuggerClient(transport);
  client.connect((app, traits) => {
    do_check_eq(traits.bulk, true);
    client.listTabs(response => {
      clientDeferred.resolve(onReady(client, response).then(() => {
        client.close();
        transport.close();
      }));
    });
  });

  DebuggerServer.onConnectionChange = type => {
    if (type === "closed") {
      serverDeferred.resolve();
    }
  };

  return promise.all([clientDeferred.promise, serverDeferred.promise]);
}

/*** Reply Types ***/

function json_reply(client, response) {
  let request = client.startBulkRequest({
    actor: response.testBulk,
    type: "jsonReply",
    length: really_long().length
  });

  // Send bulk data to server
  let copyDeferred = promise.defer();
  request.on("bulk-send-ready", ({copyFrom}) => {
    NetUtil.asyncFetch(getTestTempFile("bulk-input"), (input, status) => {
      copyFrom(input).then(() => {
        input.close();
        copyDeferred.resolve();
      });
    });
  });

  // Receive JSON reply from server
  let replyDeferred = promise.defer();
  request.on("json-reply", (reply) => {
    do_check_true(reply.allDone);
    replyDeferred.resolve();
  });

  return promise.all([copyDeferred.promise, replyDeferred.promise]);
}

function bulk_reply(client, response) {
  let request = client.startBulkRequest({
    actor: response.testBulk,
    type: "bulkReply",
    length: really_long().length
  });

  // Send bulk data to server
  let copyDeferred = promise.defer();
  request.on("bulk-send-ready", ({copyFrom}) => {
    NetUtil.asyncFetch(getTestTempFile("bulk-input"), (input, status) => {
      copyFrom(input).then(() => {
        input.close();
        copyDeferred.resolve();
      });
    });
  });

  // Receive bulk data reply from server
  let replyDeferred = promise.defer();
  request.on("bulk-reply", ({length, copyTo}) => {
    do_check_eq(length, really_long().length);

    let outputFile = getTestTempFile("bulk-output", true);
    outputFile.create(Ci.nsIFile.NORMAL_FILE_TYPE, parseInt("666", 8));

    let output = FileUtils.openSafeFileOutputStream(outputFile);

    copyTo(output).then(() => {
      FileUtils.closeSafeFileOutputStream(output);
      verify_file_size();
      replyDeferred.resolve();
    });
  });

  return promise.all([copyDeferred.promise, replyDeferred.promise]);
}

/*** Test Utils ***/

function verify_file_size() {
  let reallyLong = really_long();

  let inputFile = getTestTempFile("bulk-input");
  let outputFile = getTestTempFile("bulk-output");

  do_check_eq(inputFile.fileSize, reallyLong.length);
  do_check_eq(outputFile.fileSize, reallyLong.length);

  cleanup_files();
}

function cleanup_files() {
  let inputFile = getTestTempFile("bulk-input", true);
  if (inputFile.exists()) {
    inputFile.remove(false);
  }

  let outputFile = getTestTempFile("bulk-output", true);
  if (outputFile.exists()) {
    outputFile.remove(false);
  }
}
