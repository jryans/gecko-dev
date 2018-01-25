/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { createFactory, Component } = require("devtools/client/shared/vendor/react");
const dom = require("devtools/client/shared/vendor/react-dom-factories");
const PropTypes = require("devtools/client/shared/vendor/react-prop-types");
const { createFactories } = require("devtools/client/shared/react-utils");

const TreeViewClass = require("devtools/client/shared/components/tree/TreeView");
const TreeView = createFactory(TreeViewClass);
const { JsonToolbar } = createFactories(require("devtools/client/jsonview/components/JsonToolbar"));

const { REPS, MODE } = require("devtools/client/shared/components/reps/reps");
const { Rep } = REPS;

const AUTO_EXPAND_MAX_LEVEL = 10;

function isObject(value) {
  return Object(value) === value;
}

/**
 * A provider that converts the raw JSON of the frame dump to the tree of frame nodes we
 * want to display in the panel.
 */
const FrameProvider = {
  getChildren(node) {
    if (node instanceof FrameNode || node instanceof FrameChildList) {
      return node.children;
    }
    // Base case for the root of the frame tree
    return [ new FrameNode(node) ];
  },

  hasChildren(node) {
    if (node instanceof FrameNode || node instanceof FrameChildList) {
      return !!node.children.length;
    }
    // Base case for the root of the frame tree
    return true;
  },

  getLabel(node) {
    if (!(node instanceof FrameNode || node instanceof FrameChildList)) {
      throw new Error(`Should be a FrameNode, but was not: ${node}`);
    }
    return node.name;
  },

  getValue(node) {
    if (!(node instanceof FrameNode || node instanceof FrameChildList)) {
      throw new Error(`Should be a FrameNode, but was not: ${node}`);
    }
    return node;
  },

  getKey(node) {
    if (!(node instanceof FrameNode || node instanceof FrameChildList)) {
      throw new Error(`Should be a FrameNode, but was not: ${node}`);
    }
    return node.key;
  },

  getType(node) {
    return typeof node;
  },
};

/**
 * FrameNode should have _at least_ the following properties:
 *   - `name` {string}
 * If it is possible for the frame to have children (subtypes of nsContainerFrame), it
 * will also have:
 *   - `childLists` {array} 2-level array storing each list of child frames
 */
class FrameNode {
  constructor(data) {
    if (!data.name) {
      throw new Error(`Invalid data for FrameNode: ${data}`);
    }

    Object.assign(this, data);
    // `childLists` only present on container frames
    this.childLists = this.childLists || [];

    // `name` alone is not unique
    this.key = `${this.name}@${this.ptr}`;
  }

  get children() {
    if (this._children) {
      return this._children;
    }
    let children = [];
    for (const list of this.childLists) {
      if (list.name !== "") {
        console.log(`Node ${this.name} has non-primary list ${list.name}`);
      }
      // Each "child list" has its own name, but for now just collapse them all down.
      children = children.concat(list.children);
    }
    this._children = children.map(child => new FrameNode(child));
    // jryans: Maybe show non-primary lists later.
    // this._children = this.childLists.map(list => new FrameChildList(list));
    return this._children;
  }
}

/**
 * FrameChildList should have _at least_ the following properties:
 *   - `name` {string}
 *   - `children` {array} array of child frames
 */
class FrameChildList {
  constructor(data) {
    // The primary list's name is an empty string
    if (data.name === undefined) {
      throw new Error(`Invalid data for FrameChildList: ${data}`);
    }

    this.name = data.name || "primary";
    this.ptr = data.ptr;
    this.__children = data.children || [];

    this.key = this.name;
  }

  get children() {
    if (this._children) {
      return this._children;
    }
    this._children = this.__children.map(child => new FrameNode(child));
    return this._children;
  }
}

/**
 * The frames panel with an expandable tree view showing all the layout frames.
 */
class FrameTreePanel extends Component {
  static get propTypes() {
    return {
      frameTree: PropTypes.object,
      pickedFrameID: PropTypes.number,
      searchFilter: PropTypes.string,
      onFrameSelect: PropTypes.func,
    };
  }

  /**
   * Creates a set with the paths of the nodes that should be expanded by default
   * according to the passed options.
   * @param {Object} The root node of the tree.
   * @param {Object} [optional] An object with the following optional parameters:
   *   - maxLevel: nodes nested deeper than this level won't be expanded.
   *   - maxNodes: maximum number of nodes that can be expanded. The traversal is
   *     breadth-first, so expanding nodes nearer to the root will be preferred.
   *     Sibling nodes will either be all expanded or none expanded.
   */
  static getExpandedNodes(rootObj, { maxLevel = Infinity, maxNodes = Infinity } = {}) {
    const expandedNodes = new Set();
    const queue = [{
      object: rootObj,
      level: 1,
      path: "",
    }];
    while (queue.length) {
      const { object, level, path } = queue.shift();
      if (Object(object) !== object) {
        continue;
      }
      const children = FrameProvider.getChildren(object);
      if (expandedNodes.size + children.length > maxNodes) {
        // Avoid having children half expanded.
        break;
      }
      for (const child of children) {
        const key = FrameProvider.getKey(child);
        const nodePath = TreeViewClass.subPath(path, key);
        expandedNodes.add(nodePath);
        if (level < maxLevel) {
          queue.push({
            object: child,
            level: level + 1,
            path: nodePath,
          });
        }
      }
    }
    return expandedNodes;
  }

  constructor(props) {
    super(props);

    this.state = {
      expandedNodes: this.expandTree(),
    };

    this.onKeyPress = this.onKeyPress.bind(this);
    this.onFilter = this.onFilter.bind(this);
    this.onRowSelect = this.onRowSelect.bind(this);
    this.renderValue = this.renderValue.bind(this);
    this.renderTree = this.renderTree.bind(this);
  }

  componentDidMount() {
    document.addEventListener("keypress", this.onKeyPress, true);
  }

  componentWillReceiveProps(nextProps) {
    if (this.props.frameTree != nextProps.frameTree) {
      this.setState({
        expandedNodes: this.expandTree(),
      });
    }
    if (this.props.pickedFrameID != nextProps.pickedFrameID) {
      const pickedFramePtr = nextProps.pickedFrameID.toString(16);
      dump(`Frame: ${pickedFramePtr}\n`);
      const pickedFrameRow = this.tree.rows.find(row => {
        return row.props.member.object.ptr == pickedFramePtr;
      });
      this.tree.selectRow(pickedFrameRow);
    }
  }

  componentWillUnmount() {
    this.tree = null;

    document.removeEventListener("keypress", this.onKeyPress, true);
  }

  onKeyPress(e) {
    // XXX shortcut for focusing the Filter field (see Bug 1178771).
  }

  onFilter(object) {
    if (!this.props.searchFilter) {
      return true;
    }

    const json = object.name + JSON.stringify(object.value);
    return json.toLowerCase().includes(this.props.searchFilter.toLowerCase());
  }

  onRowSelect(row) {
    const {
      onFrameSelect,
    } = this.props;

    onFrameSelect(parseInt(row.props.member.object.ptr, 16));
  }

  expandTree() {
    const {
      frameTree,
    } = this.props;

    return FrameTreePanel.getExpandedNodes(
      frameTree,
      { maxLevel: AUTO_EXPAND_MAX_LEVEL }
    );
  }

  renderValue(props) {
    const member = props.member;

    // Hide object summary when non-empty object is expanded (bug 1244912).
    if (isObject(member.value) && member.hasChildren && member.open) {
      return null;
    }

    // Render the value (summary) using Reps library.
    return Rep(Object.assign({}, props, {
      cropLimit: 50,
      noGrip: true,
      omitLinkHref: false,
    }));
  }

  renderTree() {
    const {
      frameTree,
    } = this.props;
    const {
      expandedNodes,
    } = this.state;
    const {
      renderValue,
      onFilter,
      onRowSelect,
    } = this;

    // Append custom column for displaying values. This column
    // Take all available horizontal space.
    const columns = [{
      id: "value",
      width: "100%",
    }];

    // Render tree component.
    return TreeView({
      ref: tree => (this.tree = tree),
      object: frameTree,
      provider: FrameProvider,
      mode: MODE.TINY,
      onFilter,
      onSelect: onRowSelect,
      columns,
      renderValue,
      expandedNodes,
    });
  }

  render() {
    const content = this.renderTree();

    return (
      dom.div(
        {
          className: "tab-panel-inner",
        },
        JsonToolbar({
        }),
        dom.div(
          {
            className: "panelContent",
          },
          content
        )
      )
    );
  }
}

module.exports = FrameTreePanel;
