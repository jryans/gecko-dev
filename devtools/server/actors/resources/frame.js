/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const Services = require("Services");

loader.lazyRequireGetter(this, "assert", "devtools/shared/DevToolsUtils", true);
loader.lazyRequireGetter(this, "DebuggerServer", "devtools/server/main", true);

class FrameScanner {
  constructor(conn, context) {
    this.conn = conn;
    this.context = context;
  }

  destroy() {}

  async find({ includeRemote } = {}) {
    let frames = this.context.docShells;
    if (includeRemote) {
      frames = frames.concat(this._findRemote());
    }
    // Some values might be promises, so let's await them all.
    frames = await Promise.all(frames);
    return frames.map(frame => {
      if (frame.document) {
        return frame.document.location.href;
      }
      if (frame.DOMWindow) {
        return frame.DOMWindow.location.href;
      }
      return frame;
    });
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
    // TODO(jryans): Also loop through the other browser windows.  Could use the global
    // message manager instead...?  Would like to keep this rooted to the context, though.
    const win = this.context.window;
    if (!win.messageManager) {
      return [];
    }
    return this._findRemoteChildren(win.messageManager);
  }

  _findRemoteChildren(messageBroadcaster) {
    // TODO(jryans): This implementation assumes we must be in the parent process if we
    // have remote children at all.  This won't be true for Site Isolation, but it's all
    // we have to work with at the moment.
    const processType = Services.appinfo.processType;
    assert(
      processType == Services.appinfo.PROCESS_TYPE_DEFAULT,
      `FrameScanner expected main process, but got ${processType}`
    );
    let children = [];
    for (let i = 0; i < messageBroadcaster.childCount; i++) {
      const childMessageManager = messageBroadcaster.getChildAt(i);
      // There may be several levels of message broadcasters before reaching a frame
      // message manager.
      if (childMessageManager.childCount) {
        children = children.concat(this._findRemoteChildren(childMessageManager));
      } else {
        children.push(DebuggerServer.connectToFrame(this.conn, {
          messageManager: childMessageManager,
          addEventListener() { },
          removeEventListener() { },
        }));
      }
    }
    return children;
  }

  listen() {

  }
}

exports.FrameScanner = FrameScanner;
