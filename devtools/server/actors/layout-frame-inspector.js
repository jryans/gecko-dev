/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Actor, ActorClassWithSpec } = require("devtools/shared/protocol");
const { layoutFrameInspectorSpec } = require("devtools/shared/specs/layout-frame-inspector");

loader.lazyRequireGetter(this, "getFrameTreeAsJSON", "devtools/shared/layout/utils", true);

/**
 * The layout frame inspector actor provides access to the layout frame tree.
 */
const LayoutFrameInspectorActor = ActorClassWithSpec(layoutFrameInspectorSpec, {
  initialize(conn, tabActor) {
    Actor.prototype.initialize.call(this, conn);

    this.tabActor = tabActor;
  },

  destroy() {
    Actor.prototype.destroy.call(this);

    this.tabActor = null;
  },

  getFrameTree() {
    return getFrameTreeAsJSON(this.tabActor.window);
  },
});

exports.LayoutFrameInspectorActor = LayoutFrameInspectorActor;
