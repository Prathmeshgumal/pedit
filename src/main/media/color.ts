/** Tone-maps HDR (HLG/PQ) to SDR Rec.709. Shared by proxy generation and export so preview matches export. */
export const TONEMAP_VF =
  'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p'
