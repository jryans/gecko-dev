/* -*- Mode: C++; tab-width: 20; indent-tabs-mode: nil; c-basic-offset: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "MacIOSurfaceCompositingRenderTargetOGL.h"
#include "GLContext.h"
#include "GLContextCGL.h"
#include "GLReadTexImageHelper.h"
#include "mozilla/gfx/2D.h"
#include "mozilla/gfx/MacIOSurface.h"

namespace mozilla {
namespace layers {

using namespace mozilla::gfx;
using namespace mozilla::gl;

MacIOSurfaceCompositingRenderTargetOGL::~MacIOSurfaceCompositingRenderTargetOGL()
{
  mGL->MakeCurrent();
  mGL->fDeleteTextures(1, &mTextureHandle);
  mGL->fDeleteFramebuffers(1, &mFBO);
}

void
MacIOSurfaceCompositingRenderTargetOGL::BindTexture(GLenum aTextureUnit, GLenum aTextureTarget)
{
  MOZ_ASSERT(mInitParams.mStatus == InitParams::INITIALIZED);
  MOZ_ASSERT(mTextureHandle != 0);
  mGL->fActiveTexture(aTextureUnit);
  mGL->fBindTexture(aTextureTarget, mTextureHandle);
}

void
MacIOSurfaceCompositingRenderTargetOGL::BindRenderTarget()
{
  if (mInitParams.mStatus != InitParams::INITIALIZED) {
    InitializeImpl();
  } else {
    MOZ_ASSERT(mInitParams.mStatus == InitParams::INITIALIZED);
    mGL->fBindFramebuffer(LOCAL_GL_FRAMEBUFFER, mFBO);
    GLenum result = mGL->fCheckFramebufferStatus(LOCAL_GL_FRAMEBUFFER);
    if (result != LOCAL_GL_FRAMEBUFFER_COMPLETE) {
      // The main framebuffer (0) of non-offscreen contexts
      // might be backed by a EGLSurface that needs to be renewed.
      if (mFBO == 0 && !mGL->IsOffscreen()) {
        mGL->RenewSurface();
        result = mGL->fCheckFramebufferStatus(LOCAL_GL_FRAMEBUFFER);
      }
      if (result != LOCAL_GL_FRAMEBUFFER_COMPLETE) {
        nsAutoCString msg;
        msg.AppendPrintf("Framebuffer not complete -- CheckFramebufferStatus returned 0x%x, "
                         "GLContext=%p, IsOffscreen()=%d, mFBO=%d, "
                         "aRect.width=%d, aRect.height=%d",
                         result, mGL, mGL->IsOffscreen(), mFBO,
                         mInitParams.mSize.width, mInitParams.mSize.height);
        NS_WARNING(msg.get());
      }
    }

    mCompositor->PrepareViewport(mInitParams.mSize);
  }

  if (mClearOnBind) {
    mGL->fScissor(0, 0, mInitParams.mSize.width, mInitParams.mSize.height);
    mGL->fClearColor(0.5, 0.5, 0.5, 0.5);
    mGL->fClear(LOCAL_GL_COLOR_BUFFER_BIT);
    mClearOnBind = false;
  }
}

#ifdef MOZ_DUMP_PAINTING
TemporaryRef<DataSourceSurface>
MacIOSurfaceCompositingRenderTargetOGL::Dump(Compositor* aCompositor)
{
  MOZ_ASSERT(mInitParams.mStatus == InitParams::INITIALIZED);
  CompositorOGL* compositorOGL = static_cast<CompositorOGL*>(aCompositor);
  return ReadBackSurface(mGL, mTextureHandle, true, compositorOGL->GetFBOFormat());
}
#endif

void
MacIOSurfaceCompositingRenderTargetOGL::InitializeImpl()
{
  MOZ_ASSERT(mInitParams.mStatus == InitParams::READY);

  mGL->fGenTextures(1, &mTextureHandle);
  mGL->fBindTexture(LOCAL_GL_TEXTURE_RECTANGLE, mTextureHandle);

  mSurface = MacIOSurface::CreateIOSurface(mInitParams.mSize.width,
                                           mInitParams.mSize.height, 1.0, true);
  fprintf(stderr, "IOSurface: 0x%x\n", mSurface->GetIOSurfaceID());
  fprintf(stderr, "Size: %u x %u\n", mInitParams.mSize.width, mInitParams.mSize.height);
  // mSurface->CGLTexImageIOSurface2D(gl::GLContextCGL::Cast(mGL)->GetCGLContext());

  mGL->fTexImage2D(LOCAL_GL_TEXTURE_RECTANGLE, 0, LOCAL_GL_RGBA,
                   mInitParams.mSize.width, mInitParams.mSize.height, 0,
                   LOCAL_GL_BGRA, LOCAL_GL_UNSIGNED_INT_8_8_8_8_REV, 0);

  mGL->fTexParameteri(LOCAL_GL_TEXTURE_RECTANGLE, LOCAL_GL_TEXTURE_MIN_FILTER,
                      LOCAL_GL_LINEAR);
  mGL->fTexParameteri(LOCAL_GL_TEXTURE_RECTANGLE, LOCAL_GL_TEXTURE_MAG_FILTER,
                      LOCAL_GL_LINEAR);
  mGL->fTexParameteri(LOCAL_GL_TEXTURE_RECTANGLE, LOCAL_GL_TEXTURE_WRAP_S,
                      LOCAL_GL_CLAMP_TO_EDGE);
  mGL->fTexParameteri(LOCAL_GL_TEXTURE_RECTANGLE, LOCAL_GL_TEXTURE_WRAP_T,
                      LOCAL_GL_CLAMP_TO_EDGE);

  // Maybe?
  mGL->fBindTexture(LOCAL_GL_TEXTURE_RECTANGLE, 0);

  mGL->fGenFramebuffers(1, &mFBO);
  mGL->fBindFramebuffer(LOCAL_GL_FRAMEBUFFER, mFBO);
  mGL->fFramebufferTexture2D(LOCAL_GL_FRAMEBUFFER,
                             LOCAL_GL_COLOR_ATTACHMENT0,
                             LOCAL_GL_TEXTURE_RECTANGLE,
                             mTextureHandle,
                             0);

  // Making this call to fCheckFramebufferStatus prevents a crash on
  // PowerVR. See bug 695246.
  GLenum result = mGL->fCheckFramebufferStatus(LOCAL_GL_FRAMEBUFFER);
  if (result != LOCAL_GL_FRAMEBUFFER_COMPLETE) {
    nsAutoCString msg;
    msg.AppendPrintf("Framebuffer not complete -- error 0x%x, mFBO %d, mTextureHandle %d, aRect.width %d, aRect.height %d",
                      result, mFBO, mTextureHandle, mInitParams.mSize.width, mInitParams.mSize.height);
    NS_ERROR(msg.get());
  }

  mInitParams.mStatus = InitParams::INITIALIZED;

  mCompositor->PrepareViewport(mInitParams.mSize);
  mGL->fScissor(0, 0, mInitParams.mSize.width, mInitParams.mSize.height);
  if (mInitParams.mInit == INIT_MODE_CLEAR) {
    mGL->fClearColor(0.0, 0.0, 0.0, 0.0);
    mGL->fClear(LOCAL_GL_COLOR_BUFFER_BIT);
    mClearOnBind = false;
  }

}

}
}
