/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
"use strict";

const { Arg, RetVal, generateActorSpec } = require("devtools/shared/protocol");

const resourcesSpec = generateActorSpec({
  typeName: "resources",

  events: {
    added: {
      kind: Arg(0, "string"),
      item: Arg(1, "json"),
    },
    removed: {
      kind: Arg(0, "string"),
      item: Arg(1, "json"),
    },
  },

  methods: {
    find: {
      request: {
        kind: Arg(0, "string"),
      },
      response: {
        frames: RetVal("array:string"),
      }
    },
    listen: {
      request: {
        kind: Arg(0, "string"),
      },
    },
    unlisten: {
      request: {
        kind: Arg(0, "string"),
      },
    },
  }
});

exports.resourcesSpec = resourcesSpec;
