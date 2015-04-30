/* -*- Mode: C++; tab-width: 20; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef MOZILLA_GFX_MACIOSURFACECOMPOSITINGRENDERTARGETOGL_H
#define MOZILLA_GFX_MACIOSURFACECOMPOSITINGRENDERTARGETOGL_H

#include "GLContextTypes.h"             // for GLContext
#include "GLDefs.h"                     // for GLenum, LOCAL_GL_FRAMEBUFFER, etc
#include "mozilla/Assertions.h"         // for MOZ_ASSERT, etc
#include "mozilla/Attributes.h"         // for override
#include "mozilla/RefPtr.h"             // for RefPtr, TemporaryRef
#include "mozilla/gfx/Point.h"          // for IntSize, IntSizeTyped
#include "mozilla/gfx/Types.h"          // for SurfaceFormat, etc
#include "mozilla/layers/Compositor.h"  // for SurfaceInitMode, etc
#include "mozilla/layers/CompositorOGL.h"  // for CompositorOGL
#include "mozilla/layers/CompositingRenderTargetOGL.h"
#include "mozilla/mozalloc.h"           // for operator new
#include "nsAString.h"
#include "nsCOMPtr.h"                   // for already_AddRefed
#include "nsDebug.h"                    // for NS_ERROR, NS_WARNING
#include "nsString.h"                   // for nsAutoCString

class MacIOSurface;

namespace mozilla {
namespace gl {
  class BindableTexture;
}
namespace gfx {
  class DataSourceSurface;
}

namespace layers {

class TextureSource;

class MacIOSurfaceCompositingRenderTargetOGL : public CompositingRenderTargetOGL
{
  typedef mozilla::gl::GLContext GLContext;

  // For lazy initialisation of the GL stuff
  struct InitParams
  {
    InitParams() : mStatus(NO_PARAMS) {}
    InitParams(const gfx::IntSize& aSize,
               SurfaceInitMode aInit)
      : mStatus(READY)
      , mSize(aSize)
      , mInit(aInit)
    {}

    enum {
      NO_PARAMS,
      READY,
      INITIALIZED
    } mStatus;
    gfx::IntSize mSize;
    SurfaceInitMode mInit;
  };

public:
  MacIOSurfaceCompositingRenderTargetOGL(CompositorOGL* aCompositor, const gfx::IntPoint& aOrigin)
    : CompositingRenderTargetOGL(aCompositor, aOrigin, 0, 0)
    , mInitParams()
  {}

  ~MacIOSurfaceCompositingRenderTargetOGL();

  /**
   * Some initialisation work on the backing FBO and texture.
   * We do this lazily so that when we first set this render target on the
   * compositor we do not have to re-bind the FBO after unbinding it, or
   * alternatively leave the FBO bound after creation.
   */
  void Initialize(const gfx::IntSize& aSize,
                  GLenum aFBOTextureTarget,
                  SurfaceInitMode aInit) override
  {
    MOZ_ASSERT(mInitParams.mStatus == InitParams::NO_PARAMS, "Initialized twice?");
    // postpone initialization until we actually want to use this render target
    mInitParams = InitParams(aSize, aInit);
  }

  void BindTexture(GLenum aTextureUnit, GLenum aTextureTarget) override;

  /**
   * Call when we want to draw into our FBO
   */
  void BindRenderTarget() override;

private:
  /**
   * Actually do the initialisation. Note that we leave our FBO bound, and so
   * calling this method is only suitable when about to use this render target.
   */
  void InitializeImpl() override;

  InitParams mInitParams;
  RefPtr<MacIOSurface> mSurface;
};

}
}

#endif /* MOZILLA_GFX_MACIOSURFACECOMPOSITINGRENDERTARGETOGL_H */
