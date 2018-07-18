/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const protocol = require("devtools/shared/protocol");
const { resourcesSpec } = require("devtools/shared/specs/resources/resources");

loader.lazyRequireGetter(this, "assert", "devtools/shared/DevToolsUtils", true);

const Scanners = {};
loader.lazyRequireGetter(Scanners, "FrameScanner", "devtools/server/actors/resources/frame", true);
loader.lazyRequireGetter(Scanners, "ProcessScanner", "devtools/server/actors/resources/process", true);

/**
 * A general resource discovery mechanism for all resources related to the current
 * connection context (tab, browser, add-on, etc.).
 *
 * For example, a tab might have the following resources:
 *
 *   - Main document
 *     - Scripts
 *     - Stylesheets
 *     - Fonts
 *     - Images
 *     - Service workers [c]
 *     - Workers, worklets, etc. [t]
 *     - Add-on content scripts affecting the document
 *     - Storage
 *       - Cache Storage
 *       - Cookies [p]
 *       - Indexed DB [p]
 *       - Local Storage
 *       - Session Storage
 *     - Network request / response data [p]
 *     - Frame documents [c]
 *       - <each of these may itself have any of the above>
 *
 * Some of these resources may be remote from the current process. With Fission, child
 * frame documents may be in a different process from the main document.
 *
 * When accessing the entire browser via the Browser Toolbox, we have the following
 * resources:
 *
 *   - Browser windows
 *     - <each may have any of the resources shown above for a main document>
 *     - Browser tabs
 *       - Frame scripts [c]
 *       - Main document [c]
 *         - <each may have any of the resources shown above for a main document>
 *   - Add-ons
 *     - UI documents [c]
 *     - Background document [c]
 *     - DevTools document [c]
 *   - Process scripts [c]
 *   - Sandboxes
 *   - JSMs
 *   - Chrome workers [t]
 *   - Hidden window (from `Services.appShell.hiddenDOMWindow`)
 *   - Windowless browsers (from `Services.appShell.createWindowlessBrowser()`)
 *
 * Using this discovery mechanism, you can find the existing resources for the active
 * target and listen to be alerted when the set for that resource type changes. Resources
 * support navigating up and down the tree: from a script, you can find the document that
 * contains it; from a document, you can find the child documents.
 *
 * Everything is found lazily; we only track things of a certain type when have a client
 * who cares about that type.
 *
 * [p]: parent process
 * [t]: separate thread
 * [c]: separate content process
 */
const ResourcesActor = protocol.ActorClassWithSpec(resourcesSpec, {

  initialize(conn, context) {
    protocol.Actor.prototype.initialize.call(this, conn);
    this.context = context;
    this.docShell = context.docShell;
    this.scanners = new Map();
  },

  destroy() {
    for (const scanner of this.scanners.values()) {
      scanner.destroy();
    }
    this.scanners = null;
    this.context = null;
    this.docShell = null;
    protocol.Actor.prototype.destroy.call(this);
  },

  get includeRemote() {
    // TODO(jryans): How should this really be controlled?  Is it always on?  Is part of
    // the context for a whole toolbox?  Does each tool specify their own value when
    // looking for resources?  (The first tool that says `true` implies connecting to
    // remote frames...)
    return true;
  },

  getOrCreateScanner(type) {
    let scanner = this.scanners.get(type);
    if (scanner) {
      return scanner;
    }
    const Scanner = Scanners[`${type}Scanner`];
    assert(Scanner, `Unexpected resource type: ${type}`);
    scanner = new Scanner({
      conn: this.conn,
      context: this.context,
      emit: (eventType, ...args) => {
        this.emit(eventType, type, ...args);
      },
    });
    this.scanners.set(type, scanner);
    return scanner;
  },

  find(type) {
    const scanner = this.getOrCreateScanner(type);
    return scanner.find({ includeRemote: this.includeRemote });
  },

  listen(type) {
    const scanner = this.getOrCreateScanner(type);
    scanner.listen();
  },

  unlisten(type) {
    const scanner = this.getOrCreateScanner(type);
    scanner.unlisten();
  },

});

exports.ResourcesActor = ResourcesActor;
