// 快捷渲染面板参数体系（PRD §4，差异化核心）
// 每个分类均含「自动」档：选中自动时不写入提示词，交给模型自行判断。
// 分类可按「大类」过滤显示，避免景观参数干扰室内出图。

export type RenderDiscipline = "general" | "interior" | "architecture" | "landscape"

export interface RenderParamOption {
  value: string
  label: string
  // 写入提示词的中文片段；自动档为空。
  prompt?: string
}

export interface RenderParamCategory {
  key: string
  label: string
  // 仅在这些大类下显示；缺省表示所有大类都显示。
  disciplines?: RenderDiscipline[]
  // 多选分类（如其他修饰）。
  multiple?: boolean
  options: RenderParamOption[]
}

export const AUTO_VALUE = "auto"

const autoOption: RenderParamOption = { label: "自动", value: AUTO_VALUE }

function withAuto(options: RenderParamOption[]): RenderParamOption[] {
  return [autoOption, ...options]
}

// ---------- 大类 ----------

export const renderDisciplineOptions: { value: RenderDiscipline; label: string; prompt?: string }[] = [
  { label: "通用", value: "general" },
  { label: "室内", prompt: "室内空间效果图", value: "interior" },
  { label: "建筑", prompt: "建筑表现效果图", value: "architecture" },
  { label: "景观", prompt: "景观表现效果图", value: "landscape" },
]

// ---------- 分类枚举 ----------

export const renderParamCategories: RenderParamCategory[] = [
  {
    key: "generateMode",
    label: "生成方式",
    options: withAuto([
      { label: "白膜渲染", prompt: "将白模渲染为写实效果图，保持体块与空间关系不变", value: "whiteModel" },
      { label: "线稿上色", prompt: "将手绘线稿转为写实效果图，尊重原线稿的结构与比例", value: "sketch" },
      { label: "实景优化", prompt: "在保持原有构图的前提下提升画面质感与真实度", value: "photoEnhance" },
      { label: "风格迁移", prompt: "迁移参考图的风格与色调", value: "styleTransfer" },
      { label: "局部替换", prompt: "仅替换指定的材质或家具，其余部分保持一致", value: "replace" },
      { label: "精细重绘", prompt: "保持构图不变，重绘并丰富细节", value: "refine" },
      { label: "方案深化", prompt: "在原方案基础上补充细节与配景，使画面更完整", value: "deepen" },
    ]),
  },
  {
    disciplines: ["interior"],
    key: "spaceScene",
    label: "空间场景",
    options: withAuto([
      { label: "客厅", prompt: "客厅", value: "livingRoom" },
      { label: "餐厅", prompt: "餐厅", value: "diningRoom" },
      { label: "主卧", prompt: "主卧室", value: "masterBedroom" },
      { label: "次卧", prompt: "次卧室", value: "secondBedroom" },
      { label: "儿童房", prompt: "儿童房", value: "kidsRoom" },
      { label: "书房", prompt: "书房", value: "study" },
      { label: "厨房", prompt: "厨房", value: "kitchen" },
      { label: "卫生间", prompt: "卫生间", value: "bathroom" },
      { label: "玄关", prompt: "玄关门厅", value: "entrance" },
      { label: "衣帽间", prompt: "衣帽间", value: "wardrobe" },
      { label: "阳台", prompt: "阳台", value: "balcony" },
      { label: "办公室", prompt: "办公空间", value: "office" },
      { label: "会议室", prompt: "会议室", value: "meetingRoom" },
      { label: "接待大厅", prompt: "接待大厅", value: "lobby" },
      { label: "酒店客房", prompt: "酒店客房", value: "hotelRoom" },
      { label: "商业餐饮", prompt: "商业餐饮空间", value: "restaurant" },
      { label: "咖啡厅", prompt: "咖啡厅", value: "cafe" },
      { label: "展厅", prompt: "展厅空间", value: "showroom" },
      { label: "售楼部", prompt: "售楼部售楼中心", value: "salesCenter" },
      { label: "民宿", prompt: "民宿空间", value: "homestay" },
    ]),
  },
  {
    disciplines: ["interior"],
    key: "softFurnishing",
    label: "室内软装",
    options: withAuto([
      { label: "现代简约", prompt: "现代简约软装搭配", value: "modern" },
      { label: "轻奢", prompt: "轻奢软装，金属与大理石点缀", value: "lightLuxury" },
      { label: "侘寂风", prompt: "侘寂风，微水泥与粗陶质感", value: "wabisabi" },
      { label: "奶油风", prompt: "奶油风，柔和米白色调", value: "cream" },
      { label: "法式复古", prompt: "法式复古软装，线条护墙板", value: "french" },
      { label: "新中式", prompt: "新中式软装，木作与水墨意境", value: "newChinese" },
      { label: "日式禅意", prompt: "日式禅意，原木与素麻材质", value: "japanese" },
      { label: "北欧原木", prompt: "北欧原木风，浅色木饰面", value: "nordic" },
      { label: "工业风", prompt: "工业风，裸露管线与做旧金属", value: "industrial" },
      { label: "美式乡村", prompt: "美式乡村软装", value: "american" },
      { label: "意式极简", prompt: "意式极简，大面留白与隐形收口", value: "italian" },
      { label: "复古中古", prompt: "中古复古软装，柚木家具", value: "midCentury" },
    ]),
  },
  {
    key: "lighting",
    label: "光照 / 时刻",
    options: withAuto([
      { label: "清晨柔光", prompt: "清晨柔和光线", value: "morning" },
      { label: "正午强光", prompt: "正午强烈日光，明确的阴影", value: "noon" },
      { label: "午后斜阳", prompt: "午后斜射阳光", value: "afternoon" },
      { label: "黄金时刻", prompt: "黄金时刻暖色阳光", value: "goldenHour" },
      { label: "蓝调时刻", prompt: "蓝调时刻，冷暖对比的天光与灯光", value: "blueHour" },
      { label: "夜景灯光", prompt: "夜景，人工照明为主", value: "night" },
      { label: "阴天散射", prompt: "阴天柔和散射光", value: "overcast" },
      { label: "室内暖光", prompt: "室内暖色灯光氛围", value: "warmIndoor" },
      { label: "冷白光", prompt: "冷白色照明", value: "coolWhite" },
      { label: "戏剧侧光", prompt: "戏剧化侧光，强调明暗层次", value: "dramatic" },
      { label: "逆光轮廓", prompt: "逆光，勾勒轮廓光", value: "backlit" },
      { label: "柔和天光", prompt: "柔和均匀的天光", value: "softSky" },
    ]),
  },
  {
    disciplines: ["architecture", "landscape", "general"],
    key: "skyWeather",
    label: "天空 / 天气",
    options: withAuto([
      { label: "晴朗蓝天", prompt: "晴朗蓝天", value: "clear" },
      { label: "少云晴天", prompt: "晴天少云，通透天空", value: "fewClouds" },
      { label: "多云", prompt: "多云天空，层次丰富的云朵", value: "cloudy" },
      { label: "薄雾", prompt: "薄雾弥漫，空气透视明显", value: "mist" },
      { label: "雨后湿地", prompt: "雨后地面湿润，有反射倒影", value: "afterRain" },
      { label: "雨天", prompt: "雨天氛围", value: "rain" },
      { label: "雪天", prompt: "雪天，地面积雪", value: "snow" },
      { label: "霞光晚霞", prompt: "晚霞霞光满天", value: "sunset" },
      { label: "星空夜幕", prompt: "夜空星光", value: "starry" },
      { label: "阴天", prompt: "阴天灰白天空", value: "overcastSky" },
    ]),
  },
  {
    disciplines: ["architecture", "landscape", "general"],
    key: "season",
    label: "季节",
    options: withAuto([
      { label: "春季", prompt: "春季，新绿萌发", value: "spring" },
      { label: "初夏", prompt: "初夏，植物繁茂清新", value: "earlySummer" },
      { label: "盛夏", prompt: "盛夏，浓密绿荫", value: "summer" },
      { label: "初秋", prompt: "初秋，色叶初现", value: "earlyAutumn" },
      { label: "深秋", prompt: "深秋，金黄色叶", value: "autumn" },
      { label: "冬季", prompt: "冬季，落叶枝干", value: "winter" },
      { label: "雪后", prompt: "雪后景观", value: "afterSnow" },
    ]),
  },
  {
    disciplines: ["landscape", "architecture"],
    key: "planting",
    label: "配景植栽",
    options: withAuto([
      { label: "乔木组团", prompt: "乔木组团配景", value: "trees" },
      { label: "棕榈热带", prompt: "棕榈等热带植物", value: "tropical" },
      { label: "竹林", prompt: "竹林", value: "bamboo" },
      { label: "草坪缓坡", prompt: "草坪与缓坡地形", value: "lawn" },
      { label: "花境地被", prompt: "花境与地被植物", value: "flowerBed" },
      { label: "常绿灌木", prompt: "常绿灌木修剪整齐", value: "shrub" },
      { label: "银杏行道树", prompt: "银杏行道树", value: "ginkgo" },
      { label: "樱花树", prompt: "樱花树", value: "cherry" },
      { label: "松柏", prompt: "松柏类植物", value: "pine" },
      { label: "水生植物", prompt: "水生植物", value: "aquatic" },
      { label: "垂直绿化", prompt: "垂直绿化墙面", value: "greenWall" },
      { label: "屋顶花园", prompt: "屋顶花园绿化", value: "roofGarden" },
    ]),
  },
  {
    disciplines: ["landscape"],
    key: "waterFeature",
    label: "水景",
    options: withAuto([
      { label: "镜面水池", prompt: "镜面水池，清晰倒影", value: "mirrorPool" },
      { label: "跌水瀑布", prompt: "跌水瀑布", value: "waterfall" },
      { label: "旱喷广场", prompt: "旱喷广场", value: "dryFountain" },
      { label: "涌泉", prompt: "涌泉水景", value: "spring" },
      { label: "溪流", prompt: "自然溪流", value: "stream" },
      { label: "湖面", prompt: "开阔湖面", value: "lake" },
      { label: "游泳池", prompt: "游泳池", value: "pool" },
      { label: "生态湿地", prompt: "生态湿地", value: "wetland" },
      { label: "无水景", prompt: "画面中不出现水景", value: "none" },
    ]),
  },
  {
    disciplines: ["architecture"],
    key: "facadeMaterial",
    label: "立面材质",
    options: withAuto([
      { label: "清水混凝土", prompt: "清水混凝土立面", value: "concrete" },
      { label: "白色铝板", prompt: "白色铝板立面", value: "whiteAluminum" },
      { label: "深灰金属板", prompt: "深灰金属板立面", value: "darkMetal" },
      { label: "玻璃幕墙", prompt: "玻璃幕墙", value: "glassCurtain" },
      { label: "石材干挂", prompt: "干挂石材立面", value: "stone" },
      { label: "红砖", prompt: "红砖立面", value: "brick" },
      { label: "木格栅", prompt: "木格栅立面", value: "woodLouver" },
      { label: "陶土板", prompt: "陶土板立面", value: "terracotta" },
      { label: "穿孔铝板", prompt: "穿孔铝板立面", value: "perforated" },
      { label: "GRC 挂板", prompt: "GRC 预制挂板立面", value: "grc" },
      { label: "夯土", prompt: "夯土墙面", value: "rammedEarth" },
      { label: "彩釉玻璃", prompt: "彩釉玻璃立面", value: "coloredGlass" },
    ]),
  },
  {
    disciplines: ["landscape", "architecture"],
    key: "paving",
    label: "铺装",
    options: withAuto([
      { label: "花岗岩铺装", prompt: "花岗岩铺装", value: "granite" },
      { label: "透水砖", prompt: "透水砖铺装", value: "permeable" },
      { label: "木栈道", prompt: "木栈道", value: "woodDeck" },
      { label: "砾石", prompt: "砾石铺地", value: "gravel" },
      { label: "彩色沥青", prompt: "彩色沥青路面", value: "asphalt" },
      { label: "仿石砖", prompt: "仿石砖铺装", value: "stoneLike" },
      { label: "混凝土地坪", prompt: "清水混凝土地坪", value: "concreteFloor" },
      { label: "草间石", prompt: "草间石汀步", value: "grassStone" },
      { label: "塑胶场地", prompt: "塑胶运动场地", value: "rubber" },
    ]),
  },
  {
    disciplines: ["landscape"],
    key: "landscapeScene",
    label: "景观场景",
    options: withAuto([
      { label: "住宅中庭", prompt: "住宅中庭", value: "courtyard" },
      { label: "宅间花园", prompt: "宅间花园", value: "garden" },
      { label: "入口大门", prompt: "小区入口大门", value: "entrance" },
      { label: "商业街区", prompt: "商业街区", value: "commercial" },
      { label: "城市公园", prompt: "城市公园", value: "park" },
      { label: "滨水步道", prompt: "滨水步道", value: "waterfront" },
      { label: "屋顶花园", prompt: "屋顶花园", value: "roof" },
      { label: "儿童活动场", prompt: "儿童活动场地", value: "playground" },
      { label: "运动场地", prompt: "运动场地", value: "sports" },
      { label: "广场", prompt: "城市广场", value: "plaza" },
      { label: "校园景观", prompt: "校园景观", value: "campus" },
      { label: "办公园区", prompt: "办公园区景观", value: "businessPark" },
      { label: "示范区展示", prompt: "地产示范区展示空间", value: "showArea" },
    ]),
  },
  {
    key: "cameraView",
    label: "相机视角",
    options: withAuto([
      { label: "人视平视", prompt: "人眼视高平视构图", value: "eyeLevel" },
      { label: "低角度仰视", prompt: "低角度仰视，强调体量感", value: "lowAngle" },
      { label: "俯视鸟瞰", prompt: "高空俯视鸟瞰", value: "birdView" },
      { label: "半鸟瞰", prompt: "半鸟瞰视角", value: "semiBird" },
      { label: "一点透视", prompt: "一点透视构图", value: "onePoint" },
      { label: "两点透视", prompt: "两点透视构图", value: "twoPoint" },
      { label: "轴测图", prompt: "轴测视角", value: "axonometric" },
      { label: "特写局部", prompt: "局部特写", value: "closeup" },
      { label: "广角全景", prompt: "广角全景构图", value: "wide" },
      { label: "无人机高空", prompt: "无人机高空视角", value: "drone" },
    ]),
  },
  {
    key: "angle3d",
    label: "3D 角度",
    options: withAuto([
      { label: "正视图", prompt: "正视角度", value: "front" },
      { label: "左前 45°", prompt: "左前 45 度角度", value: "left45" },
      { label: "右前 45°", prompt: "右前 45 度角度", value: "right45" },
      { label: "侧立面", prompt: "侧立面角度", value: "side" },
      { label: "背面", prompt: "背面角度", value: "back" },
      { label: "顶视", prompt: "顶视角度", value: "top" },
      { label: "等轴测", prompt: "等轴测角度", value: "isometric" },
    ]),
  },
  {
    key: "styleGrade",
    label: "风格档",
    options: withAuto([
      { label: "写实照片级", prompt: "照片级写实渲染", value: "photoreal" },
      { label: "杂志大片", prompt: "杂志大片质感，精致构图", value: "magazine" },
      { label: "竞赛风格", prompt: "建筑竞赛表现风格", value: "competition" },
      { label: "概念手绘感", prompt: "概念表现，带手绘感", value: "conceptual" },
      { label: "清透日式", prompt: "清透明亮的日式表现", value: "japaneseLight" },
      { label: "暗调电影感", prompt: "暗调电影感氛围", value: "cinematic" },
      { label: "明亮通透", prompt: "明亮通透的画面", value: "bright" },
      { label: "胶片质感", prompt: "胶片颗粒质感", value: "film" },
      { label: "超写实 CG", prompt: "超写实 CG 渲染质感", value: "hyperreal" },
    ]),
  },
  {
    key: "textureBoost",
    label: "纹理增强",
    options: withAuto([
      { label: "材质细节增强", prompt: "增强材质细节表现", value: "detail" },
      { label: "微反射高光", prompt: "细腻的反射与高光", value: "reflection" },
      { label: "清晰纹理", prompt: "清晰锐利的纹理", value: "sharpTexture" },
      { label: "自然做旧", prompt: "自然做旧痕迹", value: "aged" },
      { label: "柔和噪点", prompt: "柔和的自然噪点", value: "grain" },
      { label: "高动态范围", prompt: "高动态范围，明暗细节丰富", value: "hdr" },
      { label: "锐利边缘", prompt: "锐利干净的边缘", value: "sharpEdge" },
      { label: "真实布料肌理", prompt: "真实的布料肌理", value: "fabric" },
    ]),
  },
  {
    key: "otherModifiers",
    label: "其他修饰",
    multiple: true,
    options: [
      { label: "去除水印", prompt: "去除画面中的水印与标识", value: "removeWatermark" },
      { label: "去除人物", prompt: "画面中不出现人物", value: "removePeople" },
      { label: "保留原构图", prompt: "严格保留原有构图与透视", value: "keepComposition" },
      { label: "增加人物活动", prompt: "适当增加人物活动，增强生活气息", value: "addPeople" },
      { label: "增加车辆", prompt: "适当增加车辆配景", value: "addCars" },
      { label: "去除杂物", prompt: "清理画面中的杂物", value: "removeClutter" },
      { label: "统一色调", prompt: "统一整体色调", value: "unifyTone" },
      { label: "提升整洁度", prompt: "提升画面整洁度", value: "tidy" },
      { label: "加强景深", prompt: "加强景深层次", value: "depthOfField" },
      { label: "去除文字标识", prompt: "去除画面中的文字与标牌", value: "removeText" },
    ],
  },
]

// ---------- 选择状态 ----------

// key -> 单选值 或 多选值数组
export type RenderParamSelection = Record<string, string | string[]>

export function createDefaultSelection(): RenderParamSelection {
  const selection: RenderParamSelection = {}
  for (const category of renderParamCategories) {
    selection[category.key] = category.multiple ? [] : AUTO_VALUE
  }
  return selection
}

// 按大类过滤出应展示的分类。
export function getVisibleCategories(discipline: RenderDiscipline) {
  return renderParamCategories.filter(
    (category) => !category.disciplines || category.disciplines.includes(discipline)
  )
}

// 取出某分类中已选中的提示词片段。
export function getSelectedPrompts(category: RenderParamCategory, selection: RenderParamSelection) {
  const selected = selection[category.key]
  const values = Array.isArray(selected) ? selected : selected ? [selected] : []
  return values
    .filter((value) => value !== AUTO_VALUE)
    .map((value) => category.options.find((option) => option.value === value)?.prompt)
    .filter((prompt): prompt is string => Boolean(prompt))
}

// 统计非自动档的选中数量，用于面板上的角标提示。
export function countActiveSelections(discipline: RenderDiscipline, selection: RenderParamSelection) {
  return getVisibleCategories(discipline).reduce(
    (total, category) => total + getSelectedPrompts(category, selection).length,
    0
  )
}
