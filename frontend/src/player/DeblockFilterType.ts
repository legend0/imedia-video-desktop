export interface AdaptiveDeblockEffect {
  fragment: {
    uniform: {
      u_deblockStrength: string;
      u_texelSize: string;
    };
    main: string;
  };
  uniforms: Array<{
    name: string;
    type: string;
    data: number[];
  }>;
  strength: number;
  disabled: boolean;
}

/**
 * 创建自适应去块效应滤镜 effect。
 *
 * 注意：Kampos 内部 _setUniforms 会按 `uniform${size}${type}v` 拼接 GL 方法名，
 * 其中 size 取自 `uniform.size || uniform.data.length`。因此每个 uniform 的 data
 * 长度必须与 shader 中声明的类型严格匹配（float=1, vec2=2, vec3=3, vec4=4），
 * 否则会触发 GL_INVALID_OPERATION: Uniform size does not match uniform method。
 *
 * @param args.strength - 去块效应强度，范围 0~1，0 表示关闭。
 * @returns Kampos 自适应去块效应 effect 对象。
 */
export function adaptiveDeblock({ strength = 0.0 }: { strength?: number } = {}): AdaptiveDeblockEffect {
  // disabled 单独用闭包变量跟踪，避免污染 uniform 的 data 数组导致 WebGL 类型不匹配
  let isDisabled = strength === 0;

  const uniforms = [
    {
      name: 'u_deblockStrength',
      type: 'f',
      data: [strength],
    },
    {
      name: 'u_texelSize',
      type: 'f',
      data: [0.0, 0.0],
    },
  ];

  return {
    fragment: {
      uniform: {
        u_deblockStrength: 'float',
        u_texelSize: 'vec2',
      },
      main: `
    if (u_deblockStrength > 0.0) {
        vec2 off = u_texelSize;

        vec4 cL = texture2D(u_source, sourceCoord + vec2(-off.x, 0.0));
        vec4 cR = texture2D(u_source, sourceCoord + vec2(off.x, 0.0));
        vec4 cT = texture2D(u_source, sourceCoord + vec2(0.0, -off.y));
        vec4 cB = texture2D(u_source, sourceCoord + vec2(0.0, off.y));
        vec4 cTL = texture2D(u_source, sourceCoord + vec2(-off.x, -off.y));
        vec4 cTR = texture2D(u_source, sourceCoord + vec2(off.x, -off.y));
        vec4 cBL = texture2D(u_source, sourceCoord + vec2(-off.x, off.y));
        vec4 cBR = texture2D(u_source, sourceCoord + vec2(off.x, off.y));

        vec4 mean = (cL + cR + cT + cB + cTL + cTR + cBL + cBR + pixel) / 9.0;
        vec4 dL = cL - mean;
        vec4 dR = cR - mean;
        vec4 dT = cT - mean;
        vec4 dB = cB - mean;
        vec4 dTL = cTL - mean;
        vec4 dTR = cTR - mean;
        vec4 dBL = cBL - mean;
        vec4 dBR = cBR - mean;
        vec4 dP = pixel - mean;
        vec4 variance = (dL*dL + dR*dR + dT*dT + dB*dB +
                        dTL*dTL + dTR*dTR + dBL*dBL + dBR*dBR +
                        dP*dP) / 9.0;

        float avgVariance = (variance.r + variance.g + variance.b) / 3.0;
        float adaptiveStrength = clamp(avgVariance * u_deblockStrength * 2.0, 0.0, 1.0);

        vec4 smoothed = (cL + cR + cT + cB) / 4.0;
        color = mix(pixel.rgb, smoothed.rgb, adaptiveStrength);
    }`,
    },
    uniforms,
    get strength(): number {
      return this.uniforms[0].data[0];
    },
    set strength(value: number) {
      this.uniforms[0].data[0] = parseFloat(Math.max(0, Math.min(1, value)));
    },
    get disabled(): boolean {
      return isDisabled;
    },
    set disabled(toggle: boolean) {
      isDisabled = !!toggle;
    },
  };
}
