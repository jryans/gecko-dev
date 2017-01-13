/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { DOM: dom, createClass, createFactory, PropTypes, addons } =
  require("devtools/client/shared/vendor/react");

const { getStr } = require("../utils/l10n");
const Types = require("../types");

module.exports = createClass({
  displayName: "GlobalToolbar",

  propTypes: {
    onExit: PropTypes.func.isRequired,
  },

  mixins: [ addons.PureRenderMixin ],

  render() {
    let {
      onExit,
    } = this.props;

    return dom.header(
      {
        id: "global-toolbar",
        className: "container",
      },
      dom.button({
        id: "global-exit-button",
        className: "toolbar-button devtools-button",
        title: getStr("responsive.exit"),
        onClick: onExit,
      }),
    );
  },

});
