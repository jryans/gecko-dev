/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { DOM: dom, createClass, PropTypes, addons } =
  require("devtools/client/shared/vendor/react");

const Types = require("../types");
const { getStr } = require("../utils/l10n");
const throttlingProfiles = require("../data/network-throttling-profiles");

module.exports = createClass({
  displayName: "NetworkThrottlingSelector",

  propTypes: {
    networkThrottling: PropTypes.shape(Types.networkThrottling).isRequired,
    onChangeNetworkThrottling: PropTypes.func.isRequired,
  },

  mixins: [ addons.PureRenderMixin ],

  onSelectChange({ target }) {
    let {
      onChangeNetworkThrottling,
    } = this.props;

    for (let profile of throttlingProfiles) {
      // TODO: l10n?
      if (profile.id === target.value) {
        onChangeNetworkThrottling(true, profile.id);
        return;
      }
    }

    onChangeNetworkThrottling(false, "");
  },

  render() {
    let {
      networkThrottling,
    } = this.props;

    let selectClass = "viewport-device-selector";
    let selectedProfile;
    if (networkThrottling.enabled) {
      selectClass += " selected";
      selectedProfile = networkThrottling.profile;
    } else {
      // TODO: l10n?
      selectedProfile = "No throttling";
    }

    let listContent = [
      dom.option(
        {
          value: "",
          title: "",
          disabled: true,
          hidden: true,
        },
        getStr("responsive.noDeviceSelected")
      ),
      throttlingProfiles.map(profile => {
        return dom.option(
          {
            key: profile.id,
            value: profile.id,
            title: "",
          },
          profile.id // l10n
        );
      }),
    ];

    return dom.select(
      {
        className: selectClass,
        value: selectedProfile,
        title: selectedProfile,
        onChange: this.onSelectChange,
      },
      ...listContent
    );
  },

});
