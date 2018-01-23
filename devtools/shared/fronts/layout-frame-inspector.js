/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { FrontClassWithSpec, registerFront } = require("devtools/shared/protocol");
const { layoutFrameInspectorSpec } = require("devtools/shared/specs/layout-frame-inspector");

class LayoutFrameInspectorFront extends FrontClassWithSpec(layoutFrameInspectorSpec) {
  constructor(client, form) {
    super(client);
    this.actorID = form.layoutFrameInspectorActor;
    this.manage(this);
  }
}

exports.LayoutFrameInspectorFront = LayoutFrameInspectorFront;
registerFront(LayoutFrameInspectorFront);
