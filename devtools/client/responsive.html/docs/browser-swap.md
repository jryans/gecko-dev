# Overview

The RDM tool uses several forms of tab and browser swapping to integrate the
tool UI cleanly into the browser UI.  The high level steps of this process are
documented at `/devtools/docs/responsive-design-mode.md`.

This document contains a random assortment of low level notes about the steps
the browser goes through when swapping browsers between tabs.

# Connections between Browsers and Tabs

Link between tab and browser (`gBrowser._linkBrowserToTab`):

```
aTab.linkedBrowser = browser;
this._tabForBrowser.set(browser, aTab);
```

# Swapping Browsers between Tabs

When calling `swapBrowsersAndCloseOther`, the browser is not actually moved
from one tab to the other.  Instead, various properties _on_ each of the
browsers are swapped.

Browser attributes `swapBrowsersAndCloseOther` transfers between browsers:

* `usercontextid`

Tab attributes `swapBrowsersAndCloseOther` transfers between tabs:

* `usercontextid`
* `muted`
* `soundplaying`
* `busy`

Browser properties `swapBrowsersAndCloseOther` transfers between browsers:

* `mIconURL`
* `getFindBar(aOurTab)._findField.value`

Browser properties `_swapBrowserDocShells` transfers between browsers:

* `outerWindowID` in `this._outerWindowIDBrowserMap`
* `_outerWindowID` on the browser
* `permanentKey`
* New listener set via `browser.webProgress.addProgressListener`

Browser properties `swapDocShells` transfers between browsers:

* `_docShell`
* `_webBrowserFind`
* `_contentWindow`
* `_webNavigation`
* `_remoteWebNavigation`
* `_remoteWebNavigationImpl`
* `_remoteWebProgressManager`
* `_remoteWebProgress`
* `_remoteFinder`
* `_securityUI`
* `_documentURI`
* `_documentContentType`
* `_contentTitle`
* `_characterSet`
* `_contentPrincipal`
* `_imageDocument`
* `_fullZoom`
* `_textZoom`
* `_isSyntheticDocument`
* `_innerWindowID`
* `_manifestURI`

Other modules notified of the browser swap:

* `PopupNotifications._swapBrowserNotifications`
* `this._remoteWebNavigationImpl.swapBrowser(this);`
* `this._remoteWebProgressManager.swapBrowser(this);`
* `this._remoteFinder.swapBrowser(this);`

`swapFrameLoaders` swaps the actual page content.
