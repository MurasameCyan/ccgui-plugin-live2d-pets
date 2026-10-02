import { CubismRenderer_WebGL } from './cubism/Framework/src/rendering/cubismrenderer_webgl';
import { CubismShaderManager_WebGL, CubismShaderSet, type CubismShader_WebGL } from './cubism/Framework/src/rendering/cubismshader_webgl';
import { CubismWebGLOffscreenManager } from './cubism/Framework/src/rendering/cubismoffscreenmanager';
import vert from './cubism/Framework/Shaders/WebGL/vertshadersrc.vert?raw';
import vertMasked from './cubism/Framework/Shaders/WebGL/vertshadersrcmasked.vert?raw';
import vertMask from './cubism/Framework/Shaders/WebGL/vertshadersrcsetupmask.vert?raw';
import vertCopy from './cubism/Framework/Shaders/WebGL/vertshadersrccopy.vert?raw';
import vertBlend from './cubism/Framework/Shaders/WebGL/vertshadersrcblend.vert?raw';
import fragMask from './cubism/Framework/Shaders/WebGL/fragshadersrcsetupmask.frag?raw';
import frag from './cubism/Framework/Shaders/WebGL/fragshadersrcpremultipliedalpha.frag?raw';
import fragMasked from './cubism/Framework/Shaders/WebGL/fragshadersrcmaskpremultipliedalpha.frag?raw';
import fragInverted from './cubism/Framework/Shaders/WebGL/fragshadersrcmaskinvertedpremultipliedalpha.frag?raw';
import fragCopy from './cubism/Framework/Shaders/WebGL/fragshadersrccopy.frag?raw';
import fragColor from './cubism/Framework/Shaders/WebGL/fragshadersrccolorblend.frag?raw';
import fragAlpha from './cubism/Framework/Shaders/WebGL/fragshadersrcalphablend.frag?raw';
import fragBlend from './cubism/Framework/Shaders/WebGL/fragshadersrcpremultipliedalphablend.frag?raw';

type GL = WebGLRenderingContext | WebGL2RenderingContext;

export function isWebGL2(gl: GL): gl is WebGL2RenderingContext {
  return 'blitFramebuffer' in gl && typeof gl.blitFramebuffer === 'function';
}

export interface ShaderLease {
  gl: GL;
  contextID: number;
  references: number;
  shader: CubismShader_WebGL;
}
const shaderLeases = new WeakMap<GL, ShaderLease>();

// R5 exposes no per-context removal API. Keep this fixed-SHA seam here rather
// than calling deleteInstance(), which invalidates other live models/contexts.
function shaderMap(): Map<GL, CubismShader_WebGL> {
  // Upstream's fixed R5 implementation stores contexts in this private map.
  const manager = CubismShaderManager_WebGL.getInstance() as unknown as {
    _shaderMap: Map<GL, CubismShader_WebGL>;
  };
  return manager._shaderMap;
}

function releaseShader(shader: CubismShader_WebGL, gl: GL): void {
  // Compatible blend slots share programs; reserved slots have no program.
  const programs = new Set<WebGLProgram>();
  for (const set of shader._shaderSets) {
    if (set?.shaderProgram) programs.add(set.shaderProgram);
  }
  for (const program of programs) gl.deleteProgram(program);
  shader._shaderSets.length = 0;
  shader._isShaderLoaded = false;
}

export function acquireShaders(gl: GL, contextID: number): ShaderLease {
  let lease = shaderLeases.get(gl);
  if (lease?.contextID === contextID) {
    lease.references++;
    return lease;
  }
  if (lease) {
    // A restored context can keep the same JS object but none of its GL objects.
    releaseShader(lease.shader, gl);
    CubismWebGLOffscreenManager.getInstance().removeContext(gl);
    shaderMap().delete(gl);
    shaderLeases.delete(gl);
  }
  const manager = CubismShaderManager_WebGL.getInstance();
  manager.setGlContext(gl);
  const shader = manager.getShader(gl);
  Object.assign(shader, {
    _vertShaderSrc: vert,
    _vertShaderSrcMasked: vertMasked,
    _vertShaderSrcSetupMask: vertMask,
    _fragShaderSrcSetupMask: fragMask,
    _fragShaderSrcPremultipliedAlpha: frag,
    _fragShaderSrcMaskPremultipliedAlpha: fragMasked,
    _fragShaderSrcMaskInvertedPremultipliedAlpha: fragInverted,
    _vertShaderSrcCopy: vertCopy,
    _fragShaderSrcCopy: fragCopy,
    _fragShaderSrcColorBlend: fragColor,
    _fragShaderSrcAlphaBlend: fragAlpha,
    _vertShaderSrcBlend: vertBlend,
    _fragShaderSrcBlend: fragBlend,
  });
  try {
    // Exact synchronous equivalent of R5 generateShaders after its fetch step.
    shader._shaderSets.length = shader._shaderCount;
    for (let i = 0; i < shader._shaderCount; i++) shader._shaderSets[i] = new CubismShaderSet();
    shader.registerShader();
    shader.registerBlendShader();
    for (const set of shader._shaderSets) {
      if (set.shaderProgram !== undefined && !set.shaderProgram) {
        throw new Error('Unable to compile Cubism 5 R5 shaders for this WebGL context.');
      }
    }
    shader._isShaderLoaded = true;
  } catch (error) {
    releaseShader(shader, gl);
    shaderMap().delete(gl);
    throw error;
  }
  lease = { gl, contextID, references: 1, shader };
  shaderLeases.set(gl, lease);
  return lease;
}

export function releaseShaders(lease: ShaderLease): void {
  if (--lease.references !== 0 || shaderLeases.get(lease.gl) !== lease) return;
  releaseShader(lease.shader, lease.gl);
  CubismWebGLOffscreenManager.getInstance().removeContext(lease.gl);
  shaderMap().delete(lease.gl);
  shaderLeases.delete(lease.gl);
}

interface AttributeState {
  buffer: WebGLBuffer | null;
  enabled: boolean;
  size: number;
  type: number;
  normalized: boolean;
  stride: number;
  offset: number;
}

/** State at PLD's draw boundary, after its batch/geometry/shader/state reset.
 * Driver-returned vector getParameter values are unavoidable allocations; the
 * bridge itself reuses its snapshot, texture list, VAO and matrix every frame.
 */
export class CubismGLState {
  readonly gl2: WebGL2RenderingContext | undefined;
  private readonly vaoExtension: OES_vertex_array_object | null;
  private readonly vao: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null;
  private readonly attributes: AttributeState[] = [];
  private readonly textures: (WebGLTexture | null)[] = [null, null, null];
  private vertexArray: WebGLVertexArrayObject | WebGLVertexArrayObjectOES | null = null;
  private arrayBuffer: WebGLBuffer | null = null;
  private elementBuffer: WebGLBuffer | null = null;
  private program: WebGLProgram | null = null;
  private activeTexture = 0;
  framebuffer: WebGLFramebuffer | null = null;
  private readFramebuffer: WebGLFramebuffer | null = null;
  viewport: Int32Array = new Int32Array(4);
  private scissorBox: Int32Array = new Int32Array(4);
  private clearColor: Float32Array = new Float32Array(4);
  private colorMask: boolean[] = [true, true, true, true];
  private blend = false;
  private scissor = false;
  private stencil = false;
  private depth = false;
  private cull = false;
  private frontFace = 0;
  private blendSrcRGB = 0;
  private blendDstRGB = 0;
  private blendSrcAlpha = 0;
  private blendDstAlpha = 0;
  private blendEquationRGB = 0;
  private blendEquationAlpha = 0;

  constructor(readonly gl: GL) {
    this.gl2 = isWebGL2(gl) ? gl : undefined;
    this.vaoExtension = this.gl2 ? null : gl.getExtension('OES_vertex_array_object');
    this.vao = this.gl2 ? this.gl2.createVertexArray() : this.vaoExtension?.createVertexArrayOES() ?? null;
    if ((this.gl2 || this.vaoExtension) && !this.vao) throw new Error('Unable to allocate Cubism vertex array.');
    if (!this.vao) {
      const count = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
      for (let i = 0; i < count; i++) {
        this.attributes.push({ buffer: null, enabled: false, size: 4, type: gl.FLOAT, normalized: false, stride: 0, offset: 0 });
      }
    }
  }

  save(): void {
    const gl = this.gl;
    this.framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    this.readFramebuffer = this.gl2?.getParameter(this.gl2.READ_FRAMEBUFFER_BINDING) ?? null;
    this.viewport = gl.getParameter(gl.VIEWPORT);
    this.scissorBox = gl.getParameter(gl.SCISSOR_BOX);
    this.clearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    this.colorMask = gl.getParameter(gl.COLOR_WRITEMASK);
    this.program = gl.getParameter(gl.CURRENT_PROGRAM);
    this.arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    this.elementBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
    this.activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      this.textures[i] = gl.getParameter(gl.TEXTURE_BINDING_2D);
    }
    gl.activeTexture(this.activeTexture);
    this.blend = gl.isEnabled(gl.BLEND);
    this.scissor = gl.isEnabled(gl.SCISSOR_TEST);
    this.stencil = gl.isEnabled(gl.STENCIL_TEST);
    this.depth = gl.isEnabled(gl.DEPTH_TEST);
    this.cull = gl.isEnabled(gl.CULL_FACE);
    this.frontFace = gl.getParameter(gl.FRONT_FACE);
    this.blendSrcRGB = gl.getParameter(gl.BLEND_SRC_RGB);
    this.blendDstRGB = gl.getParameter(gl.BLEND_DST_RGB);
    this.blendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
    this.blendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
    this.blendEquationRGB = gl.getParameter(gl.BLEND_EQUATION_RGB);
    this.blendEquationAlpha = gl.getParameter(gl.BLEND_EQUATION_ALPHA);
    if (this.gl2) {
      this.vertexArray = gl.getParameter(this.gl2.VERTEX_ARRAY_BINDING);
      this.gl2.bindVertexArray(this.vao);
    } else if (this.vaoExtension) {
      this.vertexArray = gl.getParameter(this.vaoExtension.VERTEX_ARRAY_BINDING_OES);
      this.vaoExtension.bindVertexArrayOES(this.vao);
    } else {
      for (let i = 0; i < this.attributes.length; i++) {
        const attr = this.attributes[i];
        attr.enabled = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
        attr.buffer = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
        attr.size = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_SIZE);
        attr.type = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_TYPE);
        attr.normalized = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED);
        attr.stride = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_STRIDE);
        attr.offset = gl.getVertexAttribOffset(i, gl.VERTEX_ATTRIB_ARRAY_POINTER);
      }
    }
  }

  applyTargetClipping(): void {
    const gl = this.gl;
    this.setEnabled(gl.SCISSOR_TEST, this.scissor);
    this.setEnabled(gl.STENCIL_TEST, this.stencil);
    gl.scissor(this.scissorBox[0], this.scissorBox[1], this.scissorBox[2], this.scissorBox[3]);
    gl.viewport(this.viewport[0], this.viewport[1], this.viewport[2], this.viewport[3]);
  }

  restore(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    if (this.gl2) this.gl2.bindFramebuffer(this.gl2.READ_FRAMEBUFFER, this.readFramebuffer);
    this.applyTargetClipping();
    this.setEnabled(gl.BLEND, this.blend);
    this.setEnabled(gl.DEPTH_TEST, this.depth);
    this.setEnabled(gl.CULL_FACE, this.cull);
    gl.frontFace(this.frontFace);
    gl.blendFuncSeparate(this.blendSrcRGB, this.blendDstRGB, this.blendSrcAlpha, this.blendDstAlpha);
    gl.blendEquationSeparate(this.blendEquationRGB, this.blendEquationAlpha);
    gl.colorMask(this.colorMask[0], this.colorMask[1], this.colorMask[2], this.colorMask[3]);
    gl.clearColor(this.clearColor[0], this.clearColor[1], this.clearColor[2], this.clearColor[3]);
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[i]);
    }
    gl.activeTexture(this.activeTexture);
    gl.useProgram(this.program);
    if (this.gl2) this.gl2.bindVertexArray(this.vertexArray);
    else if (this.vaoExtension) this.vaoExtension.bindVertexArrayOES(this.vertexArray);
    else {
      for (let i = 0; i < this.attributes.length; i++) {
        const attr = this.attributes[i];
        if (attr.buffer) {
          gl.bindBuffer(gl.ARRAY_BUFFER, attr.buffer);
          gl.vertexAttribPointer(i, attr.size, attr.type, attr.normalized, attr.stride, attr.offset);
        }
        if (attr.enabled) gl.enableVertexAttribArray(i);
        else gl.disableVertexAttribArray(i);
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.arrayBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.elementBuffer);
  }

  release(): void {
    if (this.gl2) this.gl2.deleteVertexArray(this.vao);
    else this.vaoExtension?.deleteVertexArrayOES(this.vao);
  }

  private setEnabled(cap: number, enabled: boolean): void {
    if (enabled) this.gl.enable(cap);
    else this.gl.disable(cap);
  }
}

const quadIndices = new Uint16Array([0, 1, 2, 2, 1, 3]);

/** The original R5 renderer, with only its host-target boundary adapted. */
export class PixiCubismRenderer extends CubismRenderer_WebGL {
  private compositeIndices: WebGLBuffer | null = null;

  constructor(width: number, height: number, private readonly hostState: CubismGLState) {
    super(width, height);
  }

  override preDraw(): void {
    super.preDraw();
    this.gl.blendEquationSeparate(this.gl.FUNC_ADD, this.gl.FUNC_ADD);
    // R5's temporary targets must not inherit Pixi masks, but the final target
    // must retain them, including a non-zero render-texture viewport origin.
    if (this.gl.getParameter(this.gl.FRAMEBUFFER_BINDING) === this.hostState.framebuffer) {
      this.hostState.applyTargetClipping();
    }
  }

  override beforeDrawModelRenderTarget(): void {
    if (!this._modelRenderTargets.length) return;
    const gl = this.gl;
    // R5 clears before preDraw; stale host scissoring/color masks would leave
    // dirty pixels. Resizing also changes FBO, so explicitly restore the host
    // before beginDraw captures its destination (including the default FBO).
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.colorMask(true, true, true, true);
    this._currentFbo = this.hostState.framebuffer;
    for (const target of this._modelRenderTargets) {
      if (target.getBufferWidth() !== this._modelRenderTargetWidth || target.getBufferHeight() !== this._modelRenderTargetHeight) {
        if (!target.createRenderTarget(gl, this._modelRenderTargetWidth, this._modelRenderTargetHeight, this._currentFbo)) {
          throw new Error('Unable to resize Cubism model render target.');
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hostState.framebuffer);
    this._modelRenderTargets[0].beginDraw();
    this._modelRenderTargets[0].clear(0, 0, 0, 0);
    gl.viewport(0, 0, this._modelRenderTargetWidth, this._modelRenderTargetHeight);
  }

  override afterDrawModelRenderTarget(): void {
    if (!this._modelRenderTargets.length) return;
    this._modelRenderTargets[0].endDraw();
    this.hostState.applyTargetClipping();
    CubismShaderManager_WebGL.getInstance().getShader(this.gl).setupShaderProgramForOffscreenRenderTarget(this);
    // Same R5 composite quad, owned once instead of allocating a GL buffer on
    // every frame. All blend/offscreen shader equations remain upstream code.
    if (!this.compositeIndices) {
      this.compositeIndices = this.gl.createBuffer();
      if (!this.compositeIndices) throw new Error('Unable to allocate Cubism composite index buffer.');
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.compositeIndices);
      this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER, quadIndices, this.gl.STATIC_DRAW);
    } else {
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.compositeIndices);
    }
    this.gl.drawElements(this.gl.TRIANGLES, quadIndices.length, this.gl.UNSIGNED_SHORT, 0);
    this.gl.useProgram(null);
  }

  override release(): void {
    if (this.gl && this.compositeIndices) this.gl.deleteBuffer(this.compositeIndices);
    this.compositeIndices = null;
    // R5 release drops this manager without releasing its clipping contexts.
    this._offscreenClippingManager?.release();
    this._offscreenClippingManager = null;
    // These entries borrow pooled targets. Upstream renderer.release would
    // delete them, leaving the shared pool (and other models) with dead GL IDs.
    for (const offscreen of this._offscreenList) offscreen?.stopUsingRenderTexture();
    this._offscreenList.length = 0;
    super.release();
  }
}
