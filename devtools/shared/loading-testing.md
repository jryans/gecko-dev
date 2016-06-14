# Loading and Testing for devtools.html

---

## Approaches

1. Expose current loader to content
2. Use web content loader everywhere (SystemJS, etc.)
3. Build all modules into bundle (Webpack, etc.)

---

## Expose current loader to content

### Pros

* No build step
* No source maps
* Low effort transitional step to allow loading from content

### Cons

* Only works inside Firefox, separate path used for delivery on the web
