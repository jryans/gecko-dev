/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { PureComponent } = require("devtools/client/shared/vendor/react");
const dom = require("devtools/client/shared/vendor/react-dom-factories");
const { createFactories } = require("devtools/client/shared/react-utils");
const PropTypes = require("devtools/client/shared/vendor/react-prop-types");

const { JsonPanel } = createFactories(require("devtools/client/jsonview/components/JsonPanel"));

class App extends PureComponent {
  static get propTypes() {
    return {
      frameTree: PropTypes.object.isRequired,
    };
  }

  render() {
    const {
      frameTree,
    } = this.props;

    return dom.div(
      {
        id: "app",
      },
      JsonPanel({
        data: frameTree,
      })
    );
  }
}

module.exports = App;
