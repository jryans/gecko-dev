/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { PureComponent, createFactory } = require("devtools/client/shared/vendor/react");
const PropTypes = require("devtools/client/shared/vendor/react-prop-types");
const dom = require("devtools/client/shared/vendor/react-dom-factories");

const FrameTreePanel = createFactory(require("./FrameTreePanel"));

class App extends PureComponent {
  static get propTypes() {
    return {
      frameTree: PropTypes.object,
      pickedFrameID: PropTypes.number,
      onFrameSelect: PropTypes.func,
    };
  }

  render() {
    const {
      frameTree,
      pickedFrameID,
      onFrameSelect,
    } = this.props;

    return dom.div(
      {
        id: "app",
      },
      FrameTreePanel({
        frameTree,
        pickedFrameID,
        onFrameSelect,
      })
    );
  }
}

module.exports = App;
