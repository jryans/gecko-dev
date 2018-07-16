/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { appinfo, ppmm } = require("Services");

loader.lazyRequireGetter(this, "assert", "devtools/shared/DevToolsUtils", true);
loader.lazyRequireGetter(this, "DebuggerServer", "devtools/server/main", true);

const PROCESS_SCRIPT = "data:text/javascript,sendAsyncMessage('debug:new-process');";

class ProcessScanner {
  constructor(conn, context) {
    this.conn = conn;
    this.context = context;
    this.knownProcessMessageManagers = new WeakSet();
  }

  destroy() {
    this.unlisten();
    this.conn = null;
    this.context = null;
    this.knownProcessMessageManagers = null;
  }

  async find({ includeRemote } = {}) {
    // TODO(jryans): This implementation assumes we must be in the parent process if we
    // to access processes.  With Fission, the story is more complex, but we don't have
    // the platform support for such cases yet.
    const processType = appinfo.processType;
    assert(
      processType == appinfo.PROCESS_TYPE_DEFAULT,
      `ProcessScanner expected main process, but got ${processType}`
    );
    // TODO(jryans): Filter by the current context somehow?
    let processes = [{
      id: 0,
      parent: true,
    }];
    this.knownProcessMessageManagers.add(ppmm.getChildAt(0));
    if (includeRemote) {
      processes = processes.concat(this._findRemote());
    }
    // Some values might be promises, so let's await them all.
    processes = await Promise.all(processes);
    return processes;
  }

  /**
   * Bug 1437994 will eventually mirror the docShell tree across processes.
   * For now, only same process frames have docShell entries.
   *
   * The main case of interest today is targeting the whole browser, which has various
   * remote content frames.  We can find remote frames here by looping over the child
   * message managers associated with the browser's window message manager.
   */
  _findRemote() {
    const processes = [];
    for (let i = 1; i < ppmm.childCount; i++) {
      processes.push(this._connectToProcess(i));
    }
    return processes;
  }

  _connectToProcess(i) {
    const mm = ppmm.getChildAt(i);
    this.knownProcessMessageManagers.add(mm);
    return DebuggerServer.connectToContentProcess(this.conn, mm);
  }

  listen() {
    ppmm.addMessageListener("debug:new-process", this);
    ppmm.loadProcessScript(PROCESS_SCRIPT, true);
  }

  unlisten() {
    ppmm.removeMessageListener("debug:new-process", this);
    ppmm.removeDelayedProcessScript(PROCESS_SCRIPT);
  }

  async receiveMessage({ target }) {
    if (this.knownProcessMessageManagers.has(target)) {
      return;
    }
    // TODO(jryans): This assumes processes are only appended to the child list.
    // It would be much better to expose the OS PID to uniquely identify each
    // process clearly.
    const process = await this._connectToProcess(this.knownProcessMessageManagers.size());
    this.emit("added", process);
  }
}

exports.ProcessScanner = ProcessScanner;
