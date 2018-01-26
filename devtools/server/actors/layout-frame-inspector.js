/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { Actor, ActorClassWithSpec } = require("devtools/shared/protocol");
const { layoutFrameInspectorSpec } = require("devtools/shared/specs/layout-frame-inspector");
const { highlighterSpec } = require("devtools/shared/specs/highlighters");
const { highlighterActorProto } = require("devtools/server/actors/highlighters");

loader.lazyRequireGetter(this, "utilsFor", "devtools/shared/layout/utils", true);
loader.lazyRequireGetter(this, "isXUL", "devtools/server/actors/highlighters/utils/markup", true);

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
    this._winUtils = null;
    this._walker = null;
  },

  get winUtils() {
    if (this._winUtils) {
      return this._winUtils;
    }
    this._winUtils = utilsFor(this.tabActor.window);
    return this._winUtils;
  },

  getFrameTree() {
    return this.winUtils.getFrameTreeAsJSON();
  },

  getHighlighter() {
    if (this._highlighter) {
      return this._highlighter;
    }
    // jryans: Ensure this gets destroyed without manage call.
    this._highlighter = new LayoutFrameHighlighterActor(this, false);
    return this._highlighter;
  },

  get walker() {
    if (this._walker) {
      return this._walker;
    }

    this._walker = {
      emit: (type, data) => {
        // jryans: Part of the faux walker.
        switch (type) {
          case "picker-node-picked":
            this.emit("frame-pick", data.node.rawNode);
            break;
        }
      },

      attachElement: ({ clientX, clientY }) => {
        // jryans: Part of the faux walker.
        const frameID = this.winUtils.getFrameAtPoint(clientX, clientY);
        return {
          node: {
            rawNode: frameID,
          },
        };
      },
    };
    return this._walker;
  },
});

/**
 * A crazy thing that overrides the normal HighlighterActor to borrow the
 * picking functionality, except it talks in terms of frames, instead of nodes.
 *
 * A normal person might just copy the code instead... :S If it's not too crazy,
 * perhaps it will be worth extracting a base class or something.
 */
const layoutFrameHighlighterActorProto = Object.assign({}, highlighterActorProto, {
  _findAndAttachElement(event) {
    // jryans: Override to pass the whole event through...
    return this._walker.attachElement(event);
  },

  _createHighlighter() {
    this._isPreviousWindowXUL = isXUL(this._tabActor.window);
    this._highlighter = new LayoutFrameHighlighter(this._highlighterEnv);
  },

  _destroyHighlighter() {
    if (this._highlighter) {
      this._highlighter.destroy();
      this._highlighter = null;
    }
  },

  _onNavigate: function({ isTopLevel }) {
    // Skip navigation events for non top-level windows, or if the document
    // doesn't exist anymore.
    if (!isTopLevel || !this._tabActor.window.document.documentElement) {
      return;
    }

    if (this._highlighter) {
      this._highlighter.onNavigate();
    }

    highlighterActorProto._onNavigate.call(this, { isTopLevel });
  },

  // jryans: Total hack, do something better here...
  show(frameID) {
    this._highlighter.show(frameID);
  },
});

// jryans: Find a good way to extend actor classes sanely...
layoutFrameHighlighterActorProto._actorSpec = null;

const LayoutFrameHighlighterActor = ActorClassWithSpec(
  highlighterSpec,
  layoutFrameHighlighterActorProto
);

class LayoutFrameHighlighter {
  constructor(highlighterEnv) {
    this.tabActor = highlighterEnv._tabActor;
  }

  destroy() {
    this.hide();
    this.tabActor = null;
    this._winUtils = null;
  }

  get winUtils() {
    if (this._winUtils) {
      return this._winUtils;
    }
    this._winUtils = utilsFor(this.tabActor.window);
    return this._winUtils;
  }

  show(frameID) {
    if (!frameID || frameID == this.currentFrameID) {
      return true;
    }
    this.hide();
    this.currentFrameID = frameID;
    this.winUtils.setShowFrameHighlighter(this.currentFrameID, true);
    return true;
  }

  hide() {
    if (!this.currentFrameID) {
      return;
    }
    this.winUtils.setShowFrameHighlighter(this.currentFrameID, false);
    this.currentFrameID = null;
  }

  onNavigate() {
    // After navigation, the frame ID is invalid, so just forget it.
    this.currentFrameID = null;
  }
}

exports.LayoutFrameInspectorActor = LayoutFrameInspectorActor;
