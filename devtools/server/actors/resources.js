/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const protocol = require("devtools/shared/protocol");
const { resourcesSpec } = require("devtools/shared/specs/resources");

/**
 * A general resource discovery mechanism for all resources related to the current
 * connection context (tab, browser, add-on, etc.).
 *
 * For example, we might have the following web resources:
 *
 *   - Main document
 *     - Scripts
 *     - Stylesheets
 *     - Fonts
 *     - Images
 *     - Service workers
 *     - Workers
 *     - Add-ons affecting the document
 *     - Storage
 *     - Frame documents
 *       - <each of these may itself have any of the above>
 *
 * In addition, a tab also has the following native resources:
 *
 *   - Content process for the tab
 *     - Frame content processes
 *     - Worker processes
 *
 * Some of these resources may be remote from the current process.  For example, with Site
 * Isolation, child documents may be in a different process from the main document.
 *
 * Using this mechanism, you can find the existing resources for the active context and
 * listen to be alerted when the set for that resource type changes.  Resources support
 * navigating up and down the tree: from a script, you can find the document that contains
 * it; from a document, you can find the child documents.
 *
 * Everything is found lazily; we only track things of a certain type when have a client
 * who cares about that type.
 */
const ResourcesActor = protocol.ActorClassWithSpec(resourcesSpec, {

  initialize(conn, tabActor) {
    protocol.Actor.prototype.initialize.call(this, conn);
    this.tabActor = tabActor;
    this.docShell = tabActor.docShell;
  },

  find(type, { includeRemote } = {}) { },

  listen(type) { },

  destroy() {
    this.tabActor = null;
    this.docShell = null;
    protocol.Actor.prototype.destroy.call(this);
  },

});

exports.ResourcesActor = ResourcesActor;
