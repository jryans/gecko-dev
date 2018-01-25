/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { generateActorSpec, Arg, RetVal } = require("devtools/shared/protocol");

const layoutFrameInspectorSpec = generateActorSpec({
  typeName: "layoutFrameInspector",

  events: {
    "frame-pick": {
      frameID: Arg(0, "number"),
    },
  },

  methods: {
    getFrameTree: {
      request: {},
      response: {
        frameTree: RetVal("string"),
      },
    },
    getHighlighter: {
      request: {},
      response: {
        highlighter: RetVal("highlighter"),
      },
    },
  },
});

exports.layoutFrameInspectorSpec = layoutFrameInspectorSpec;
