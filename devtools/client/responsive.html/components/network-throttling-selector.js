/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* eslint-env browser */

"use strict";

const { DOM: dom, createClass, PropTypes, addons } =
  require("devtools/client/shared/vendor/react");

const { Ci } = require("chrome");
const Types = require("../types");
const { getStr } = require("../utils/l10n");
const throttlingProfiles = require("devtools/client/shared/network-throttling-profiles");

module.exports = createClass({

  displayName: "NetworkThrottlingSelector",

  propTypes: {
    networkThrottling: PropTypes.shape(Types.networkThrottling).isRequired,
    onChangeNetworkThrottling: PropTypes.func.isRequired,
  },

  mixins: [ addons.PureRenderMixin ],

  onButtonClick() {
    let utils = window.QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIDOMWindowUtils);
    let rect = this.selectElem.getBoundingClientRect();
    utils.sendMouseEvent("mousedown", rect.left + 2, rect.top + 2, 0, 1, 0);
    utils.sendMouseEvent("mouseup", rect.left + 2, rect.top + 2, 0, 1, 0);
  },

  onSelectChange({ target }) {
    let {
      onChangeNetworkThrottling,
    } = this.props;

    if (target.value == getStr("responsive.noThrottling")) {
      onChangeNetworkThrottling(false, "");
      return;
    }

    for (let profile of throttlingProfiles) {
      if (profile.id === target.value) {
        onChangeNetworkThrottling(true, profile.id);
        return;
      }
    }
  },

  render() {
    let {
      networkThrottling,
    } = this.props;

    let buttonClass = "viewport-network-throttling-button toolbar-button devtools-button";
    let selectClass = "";
    let selectedProfile;
    if (networkThrottling.enabled) {
      selectClass += " selected";
      buttonClass += " selected";
      selectedProfile = networkThrottling.profile;
    } else {
      selectedProfile = getStr("responsive.noThrottling");
    }

    let listContent = [
      dom.option(
        {
          key: "disabled",
        },
        getStr("responsive.noThrottling")
      ),
      dom.option(
        {
          key: "divider",
          className: "divider",
          disabled: true,
        }
      ),
      throttlingProfiles.map(profile => {
        return dom.option(
          {
            key: profile.id,
          },
          profile.id
        );
      }),
    ];

    return dom.span(
      {
        id: "global-network-throttling-selector",
      },
      dom.button(
        {
          className: buttonClass,
          onClick: this.onButtonClick,
        }
      ),
      dom.select(
        {
          ref: elem => {
            this.selectElem = elem;
          },
          className: selectClass,
          value: selectedProfile,
          onChange: this.onSelectChange,
        },
        ...listContent
      )
    );
  },

});
