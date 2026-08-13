// 快捷渲染面板的参数体系（P1 差异化核心）。
// 每个分类都含「自动」档，代表不注入该维度的提示词，交由模型自行判断。

export type RenderSceneKind = "interior" | "architecture" | "landscape" | "product" | "general"

export interface RenderParamOption {
  /** 存储值，"auto" 表示不注入提示词 */
  value: string
  /** 界面显示的中文名 */
  label: string
  /** 注入到提示词中的英文描述 */
  prompt?: string
}

export interface RenderParamGroup {
  key: string
  label: string
  /** 仅在这些场景下显示；缺省表示所有场景通用 */
  scenes?: RenderSceneKind[]
  options: RenderParamOption[]
}

export const AUTO_VALUE = "auto"

const auto: RenderParamOption = { label: "自动", value: AUTO_VALUE }

export const renderSceneOptions: { value: RenderSceneKind; label: string }[] = [
  { label: "室内空间", value: "interior" },
  { label: "建筑外观", value: "architecture" },
  { label: "景观环境", value: "landscape" },
  { label: "产品静物", value: "product" },
  { label: "通用", value: "general" },
]

export const renderParamGroups: RenderParamGroup[] = [
  {
    key: "style",
    label: "风格定位",
    options: [
      auto,
      { label: "现代简约", prompt: "modern minimalist style", value: "modern" },
      { label: "侘寂风", prompt: "wabi-sabi style, raw natural textures", value: "wabi-sabi" },
      { label: "奶油风", prompt: "cream style, soft rounded forms, warm off-white palette", value: "cream" },
      { label: "法式复古", prompt: "french vintage style, ornate mouldings", value: "french" },
      { label: "新中式", prompt: "new chinese style, oriental restraint", value: "chinese" },
      { label: "日式原木", prompt: "japanese style, light oak wood", value: "japanese" },
      { label: "工业风", prompt: "industrial style, exposed concrete and metal", value: "industrial" },
      { label: "极简禅意", prompt: "zen minimalism, meditative emptiness", value: "zen" },
      { label: "北欧", prompt: "scandinavian style, bright and airy", value: "nordic" },
      { label: "美式轻奢", prompt: "american light luxury style", value: "american" },
      { label: "包豪斯", prompt: "bauhaus style, geometric primary forms", value: "bauhaus" },
      { label: "未来科技", prompt: "futuristic high-tech style", value: "futuristic" },
    ],
  },
  {
    key: "space",
    label: "空间类型",
    scenes: ["interior"],
    options: [
      auto,
      { label: "客厅", prompt: "living room", value: "living" },
      { label: "卧室", prompt: "bedroom", value: "bedroom" },
      { label: "餐厅", prompt: "dining room", value: "dining" },
      { label: "厨房", prompt: "kitchen", value: "kitchen" },
      { label: "卫浴", prompt: "bathroom", value: "bathroom" },
      { label: "书房", prompt: "study room, home office", value: "study" },
      { label: "玄关", prompt: "entryway, foyer", value: "entry" },
      { label: "儿童房", prompt: "children bedroom", value: "kids" },
      { label: "办公空间", prompt: "office space", value: "office" },
      { label: "商业零售", prompt: "retail store interior", value: "retail" },
      { label: "餐饮空间", prompt: "restaurant interior", value: "restaurant" },
      { label: "酒店大堂", prompt: "hotel lobby", value: "hotel" },
    ],
  },
  {
    key: "buildingType",
    label: "建筑类型",
    scenes: ["architecture"],
    options: [
      auto,
      { label: "住宅", prompt: "residential building", value: "residential" },
      { label: "高层办公", prompt: "high-rise office tower", value: "office" },
      { label: "文化场馆", prompt: "cultural venue, museum architecture", value: "cultural" },
      { label: "商业综合体", prompt: "commercial complex", value: "commercial" },
      { label: "学校", prompt: "school campus architecture", value: "school" },
      { label: "民宿", prompt: "boutique guesthouse", value: "guesthouse" },
      { label: "工业厂房", prompt: "industrial facility", value: "industrial" },
      { label: "交通枢纽", prompt: "transportation hub", value: "transport" },
    ],
  },
  {
    key: "landscapeType",
    label: "景观类型",
    scenes: ["landscape"],
    options: [
      auto,
      { label: "住宅景观", prompt: "residential landscape", value: "residential" },
      { label: "城市公园", prompt: "urban park", value: "park" },
      { label: "商业街区", prompt: "commercial streetscape", value: "street" },
      { label: "庭院", prompt: "courtyard garden", value: "courtyard" },
      { label: "屋顶花园", prompt: "rooftop garden", value: "rooftop" },
      { label: "滨水空间", prompt: "waterfront landscape", value: "waterfront" },
      { label: "广场", prompt: "civic plaza", value: "plaza" },
    ],
  },
  {
    key: "view",
    label: "视角构图",
    options: [
      auto,
      { label: "一点透视", prompt: "one-point perspective", value: "one-point" },
      { label: "两点透视", prompt: "two-point perspective", value: "two-point" },
      { label: "人视平视", prompt: "eye-level view", value: "eye-level" },
      { label: "鸟瞰", prompt: "aerial bird's-eye view", value: "aerial" },
      { label: "航拍俯视", prompt: "top-down drone view", value: "top-down" },
      { label: "仰视", prompt: "low-angle upward view", value: "low-angle" },
      { label: "轴测", prompt: "axonometric view", value: "axonometric" },
      { label: "局部特写", prompt: "close-up detail shot", value: "closeup" },
      { label: "广角全景", prompt: "wide-angle panoramic view", value: "wide" },
    ],
  },
  {
    key: "light",
    label: "光照氛围",
    options: [
      auto,
      { label: "自然日光", prompt: "natural daylight", value: "daylight" },
      { label: "柔和晨光", prompt: "soft morning light", value: "morning" },
      { label: "黄金时刻", prompt: "golden hour warm sunlight", value: "golden" },
      { label: "蓝调时刻", prompt: "blue hour twilight", value: "blue-hour" },
      { label: "夜景灯光", prompt: "night scene with artificial lighting", value: "night" },
      { label: "阴天漫射", prompt: "overcast diffused light", value: "overcast" },
      { label: "戏剧光影", prompt: "dramatic chiaroscuro lighting", value: "dramatic" },
      { label: "逆光", prompt: "backlit silhouette lighting", value: "backlit" },
      { label: "影棚布光", prompt: "studio softbox lighting", value: "studio" },
    ],
  },
  {
    key: "material",
    label: "主材质感",
    options: [
      auto,
      { label: "原木", prompt: "natural wood surfaces", value: "wood" },
      { label: "微水泥", prompt: "micro-cement finish", value: "micro-cement" },
      { label: "天然石材", prompt: "natural stone slabs", value: "stone" },
      { label: "大理石", prompt: "polished marble", value: "marble" },
      { label: "金属拉丝", prompt: "brushed metal accents", value: "metal" },
      { label: "玻璃幕墙", prompt: "glass curtain wall", value: "glass" },
      { label: "清水混凝土", prompt: "fair-faced concrete", value: "concrete" },
      { label: "布艺织物", prompt: "soft fabric textiles", value: "fabric" },
      { label: "陶砖", prompt: "terracotta brick", value: "brick" },
      { label: "藤编", prompt: "woven rattan", value: "rattan" },
    ],
  },
  {
    key: "colorTone",
    label: "色彩基调",
    options: [
      auto,
      { label: "暖白米色", prompt: "warm white and beige palette", value: "warm-white" },
      { label: "冷灰高级", prompt: "cool grey sophisticated palette", value: "cool-grey" },
      { label: "莫兰迪", prompt: "morandi muted palette", value: "morandi" },
      { label: "黑白灰", prompt: "monochrome black white grey", value: "mono" },
      { label: "大地色", prompt: "earth tone palette", value: "earth" },
      { label: "低饱和木色", prompt: "desaturated wood tones", value: "wood-tone" },
      { label: "高饱和撞色", prompt: "high-saturation contrasting colors", value: "vivid" },
      { label: "单色渐层", prompt: "monochromatic gradient palette", value: "gradient" },
    ],
  },
  {
    key: "furnishing",
    label: "软装陈设",
    scenes: ["interior"],
    options: [
      auto,
      { label: "极简留白", prompt: "minimal furnishing, generous negative space", value: "minimal" },
      { label: "常规配置", prompt: "standard furnishing set", value: "standard" },
      { label: "丰富陈设", prompt: "richly furnished with decor layers", value: "rich" },
      { label: "绿植点缀", prompt: "accented with indoor plants", value: "plants" },
      { label: "艺术挂画", prompt: "curated wall art", value: "artwork" },
      { label: "书籍器物", prompt: "books and ceramic objects", value: "objects" },
      { label: "灯具主导", prompt: "statement lighting fixtures", value: "lighting" },
    ],
  },
  {
    key: "paving",
    label: "地面铺装",
    scenes: ["interior", "landscape", "architecture"],
    options: [
      auto,
      { label: "木地板", prompt: "wooden flooring", value: "wood-floor" },
      { label: "大板瓷砖", prompt: "large-format porcelain tile", value: "large-tile" },
      { label: "水磨石", prompt: "terrazzo flooring", value: "terrazzo" },
      { label: "自流平", prompt: "seamless self-leveling floor", value: "seamless" },
      { label: "地毯", prompt: "carpeted floor", value: "carpet" },
      { label: "石材铺装", prompt: "stone paving", value: "stone-paving" },
      { label: "透水砖", prompt: "permeable paver", value: "permeable" },
      { label: "草坪", prompt: "lawn ground cover", value: "lawn" },
    ],
  },
  {
    key: "planting",
    label: "配景植栽",
    scenes: ["landscape", "architecture"],
    options: [
      auto,
      { label: "乔木为主", prompt: "canopy trees dominant", value: "trees" },
      { label: "灌木层次", prompt: "layered shrub planting", value: "shrubs" },
      { label: "草花地被", prompt: "flowering ground cover", value: "flowers" },
      { label: "竹林", prompt: "bamboo grove", value: "bamboo" },
      { label: "棕榈热带", prompt: "tropical palms", value: "tropical" },
      { label: "针叶林", prompt: "coniferous trees", value: "conifer" },
      { label: "枯山水", prompt: "dry rock garden, karesansui", value: "rock-garden" },
    ],
  },
  {
    key: "sky",
    label: "天空天气",
    scenes: ["architecture", "landscape"],
    options: [
      auto,
      { label: "晴朗蓝天", prompt: "clear blue sky", value: "clear" },
      { label: "薄云", prompt: "thin scattered clouds", value: "light-clouds" },
      { label: "戏剧云层", prompt: "dramatic cloud formations", value: "dramatic-clouds" },
      { label: "晚霞", prompt: "sunset afterglow sky", value: "sunset" },
      { label: "雨后湿地", prompt: "post-rain wet surfaces", value: "after-rain" },
      { label: "雪景", prompt: "snow covered scene", value: "snow" },
      { label: "薄雾", prompt: "light mist atmosphere", value: "mist" },
    ],
  },
  {
    key: "people",
    label: "人物活动",
    scenes: ["interior", "architecture", "landscape"],
    options: [
      auto,
      { label: "无人", prompt: "no people", value: "none" },
      { label: "少量剪影", prompt: "few silhouetted figures", value: "silhouette" },
      { label: "自然活动", prompt: "people in natural activity", value: "natural" },
      { label: "热闹人群", prompt: "lively crowd", value: "crowd" },
    ],
  },
  {
    key: "render",
    label: "表现方式",
    options: [
      auto,
      { label: "写实照片级", prompt: "photorealistic render", value: "photoreal" },
      { label: "商业效果图", prompt: "commercial architectural visualization", value: "commercial" },
      { label: "概念手绘", prompt: "conceptual hand sketch", value: "sketch" },
      { label: "水彩", prompt: "watercolor illustration", value: "watercolor" },
      { label: "马克笔", prompt: "marker rendering", value: "marker" },
      { label: "线稿", prompt: "clean line drawing", value: "line" },
      { label: "白模", prompt: "white clay model render", value: "white-model" },
      { label: "拼贴", prompt: "architectural collage", value: "collage" },
    ],
  },
  {
    key: "lens",
    label: "镜头参数",
    options: [
      auto,
      { label: "16mm 超广", prompt: "16mm ultra-wide lens", value: "16mm" },
      { label: "24mm 广角", prompt: "24mm wide lens", value: "24mm" },
      { label: "35mm 人文", prompt: "35mm documentary lens", value: "35mm" },
      { label: "50mm 标准", prompt: "50mm standard lens", value: "50mm" },
      { label: "85mm 中长焦", prompt: "85mm portrait lens", value: "85mm" },
      { label: "移轴校正", prompt: "tilt-shift corrected verticals", value: "tilt-shift" },
      { label: "浅景深", prompt: "shallow depth of field", value: "shallow-dof" },
    ],
  },
  {
    key: "detail",
    label: "纹理增强",
    options: [
      auto,
      { label: "细节丰富", prompt: "highly detailed textures", value: "high-detail" },
      { label: "极致材质", prompt: "ultra-detailed material microtexture", value: "ultra-detail" },
      { label: "柔化处理", prompt: "softened smooth surfaces", value: "soft" },
      { label: "胶片颗粒", prompt: "subtle film grain", value: "grain" },
      { label: "干净锐利", prompt: "clean crisp edges", value: "crisp" },
    ],
  },
  {
    key: "quality",
    label: "画质等级",
    options: [
      auto,
      { label: "标准", prompt: "high quality", value: "standard" },
      { label: "精细", prompt: "very high quality, refined", value: "fine" },
      { label: "大师级", prompt: "masterpiece quality, award-winning visualization", value: "masterpiece" },
    ],
  },
]

/** 按场景过滤出应显示的参数分类 */
export function groupsForScene(scene: RenderSceneKind): RenderParamGroup[] {
  return renderParamGroups.filter((group) => !group.scenes || group.scenes.includes(scene))
}

/** 该分类在当前场景下是否可用 */
export function isGroupVisible(group: RenderParamGroup, scene: RenderSceneKind): boolean {
  return !group.scenes || group.scenes.includes(scene)
}

export type RenderParamValues = Record<string, string>

/** 全部置为「自动」的初始值 */
export function createDefaultParamValues(): RenderParamValues {
  const values: RenderParamValues = {}
  for (const group of renderParamGroups) {
    values[group.key] = AUTO_VALUE
  }
  return values
}

/** 统计已手动选择（非自动）的数量 */
export function countActiveParams(values: RenderParamValues, scene: RenderSceneKind): number {
  return groupsForScene(scene).filter((group) => {
    const value = values[group.key]
    return Boolean(value) && value !== AUTO_VALUE
  }).length
}
