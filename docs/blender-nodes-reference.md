# Blender 节点体系深度资料

> **数据来源**：Blender 官方手册仓库 `projects.blender.org/blender/blender-manual`，`main` 分支（最新开发版，含未发布实验性节点）。
> **抓取方式**：从 Gitea raw 端点拉取 RST 索引（`docs.blender.org` 有 Cloudflare 拦截，改用源码仓库）。
> **覆盖范围**：Shader Nodes / Geometry Nodes / Compositing 三大节点图 + Materials 索引。
> **整理日期**：2026-11-01

---

## 一、Shader Nodes（着色器节点）

求值上下文：每个节点声明 `ShaderType`（Surface/Volume/Displacement）与 `Global` 两个 socket 类型；Cycles/Eevee 按 BSDF 闭包组合，输出辐射度而非颜色。

### 1.1 Input（输入）

| 子组 | 节点 |
|------|------|
| Constant | `boolean` `color` `integer` `menu` `string` `value` `vector` |
| 场景/几何 | `ao` `attribute` `bevel` `camera_data` `fresnel` `geometry` `hair_info` `layer_weight` `light_evaluation` `light_info` `light_path` `object_info` `particle_info` `point_info` `raycast` `scene_time` `shadow_raycast` `tangent` `texture_coordinate` `uv_map` `vertex_color` `volume_info` `wireframe` |

新节点：`light_evaluation` `light_info` `point_info` `shadow_raycast`（细化光照与点查询）。

### 1.2 Output（输出）

`aov` `material` `light` `world` `enable_output` `warning`

### 1.3 Shader（BSDF 闭包）

`add` `mix` `background` `diffuse` `emission` `glass` `glossy` `refraction` `translucent` `transparent` `toon` `sss` `holdout`
`principled` `hair_principled` `volume_principled` `hair` `sheen` `metallic` `specular_bsdf` `ray_portal` `light_accumulation`
`volume_absorption` `volume_scatter` `volume_coefficients`

新节点：`metallic` `specular_bsdf` `sheen`（从 Principled 拆出的独立 BSDF）、`ray_portal`（光线传送，做镜头内折射递归）、`light_accumulation`（直接访问光累积量）。

### 1.4 Displacement（置换）

`bump` `displacement` `normal_map` `vector_displacement`

### 1.5 Texture（程序化纹理源）

`brick` `checker` `environment` `gabor` `gradient` `ies` `image` `magic` `noise` `sky` `voronoi` `wave` `white_noise`

新节点：`gabor`（Gabor 小波，方向性纹理）、`white_noise`（哈希白噪，用于随机化）、`ies`（IES 光分布文件）。
注意：**`musgrave` 已从 Shader 中移除**（合并进 `noise`），仅保留在 Geometry Nodes。

### 1.6 Color（颜色）

`blackbody` `bright_contrast` `color_ramp` `gamma` `hue_saturation` `invert_color` `light_falloff` `mix` `rgb_curves` `wavelength`
`combine_color` `separate_color` `rgb_to_bw` `shader_to_rgb`

### 1.7 Utilities（工具）

| 子组 | 节点 |
|------|------|
| Math | `boolean_math` `clamp` `float_curve` `map_range` `integer_math` `math` `mix` |
| Text | `format_string` `match_string` `replace_string` `reverse_string` `set_string_case` `slice_string` `trim_string` `find_in_string` `string_length` `string_to_value` `value_to_string` `special_characters` |
| Vector | `combine_xyz` `separate_xyz` `get_vector_component` `mix_vector` `mapping` `normal` `curves` `radial_tiling` `vector_math` `vector_rotate` `transform` `combine_cylindrical` `combine_spherical` `separate_cylindrical` `separate_spherical` |
| Bundle | `combine_bundle` `join_bundle` `separate_bundle` |
| 闭包 | `closure` `evaluate_closure` |
| 控制流 | `repeat` `index_switch` `menu_switch` `switch` `implicit_conversion` |
| 扩展 | `script` |

重大新增：
- **Text 节点族**：着色器内可做字符串处理（格式化/切片/查找/转换），着色器可读字符串属性并参与逻辑。
- **Bundle**：新数据容器类型，跨 socket 传递打包数据。
- **Closure / evaluate_closure**：把 BSDF 闭包作为一等数据操作（采样、组合），突破"闭包只能进 Mix/Add"限制。
- **Repeat**：着色器内循环（受限于无副作用求值，主要用于纹理迭代）。
- **radial_tiling / 球面-柱面坐标组合**：程序化无缝铺贴与坐标变换。
- **script**：自定义脚本节点（OSL/Python）入口。

---

## 二、Geometry Nodes（几何节点）

求值上下文：基于字段（Field）系统，节点声明 `GeometrySet`、`Field<T>`、`Value` 三类 socket；惰性字段求值，按域（Point/Edge/Face/FaceCorner/Spline/Instance）分发，支持隐式属性传播。

### 2.1 Input

| 子组 | 节点 |
|------|------|
| Constant | `boolean` `collection` `color` `font` `image` `integer` `material` `menu` `object` `rotation` `string` `value` `vector` |
| Scene | `3d_cursor` `active_camera` `bone_info` `camera_info` `collection_children` `collection_info` `image_info` `is_viewport` `mouse_position` `object_info` `scene_time` `self_object` `viewport_transform` |
| Gizmo / Import | （子目录，含交互 gizmo 与外部资产导入） |

新节点：`mouse_position` `3d_cursor` `viewport_transform` `is_viewport` `bone_info` `camera_info`——几何节点可响应鼠标与视图，迈向交互式工具构建。

### 2.2 Output

`enable_output` `warning` `viewer`

### 2.3 Attribute（属性）

`attribute_statistic` `domain_size` `get_attribute_names`
`blur_attribute` `capture_attribute` `remove_named_attribute` `rename_attribute` `store_named_attribute` `transfer_attributes`

新节点：`blur_attribute`（属性空间模糊，做程序化渐变/磨损关键）、`capture_attribute`（域内捕获，比 store 更安全）、`get_attribute_names`（动态枚举属性）。

### 2.4 Geometry（通用几何）

| 子组 | 节点 |
|------|------|
| Read | `id` `input_index` `named_attribute` `normal` `position` `radius` `active_element` `selection` `get_geometry_bundle` |
| Sample | `geometry_principal_components` `geometry_proximity` `index_of_nearest` `raycast` `sample_index` `sample_nearest` |
| Write | `set_geometry_bundle` `set_geometry_name` `set_id` `set_position` `set_selection` |
| Operations | `bake` `bounding_box` `convex_hull` `delete_geometry` `duplicate_elements` `merge_by_distance` `merge_points` `split_to_instances` `sort_elements` `transform_geometry` `get_geometry_components` `separate_components` `separate_geometry` `displace_geometry` `smooth_geometry` |
| 其他 | `geometry_to_instance` `join_geometry` `geometry_input` `selection`（+ `material/` 子目录） |

新节点：`displace_geometry` `smooth_geometry`（几何级位移/平滑，非逐点）、`sort_elements`（按字段排序元素）、`split_to_instances`、`geometry_principal_components`（PCA，做主轴对齐）、`set_geometry_name`。

### 2.5 Curve（曲线）

| 子组 | 节点 |
|------|------|
| Operations | `curve_to_mesh` `curve_to_points` `curves_to_grease_pencil` `deform_curves_on_surface` `fill_curve` `fillet_curve` `interpolate_curves` `resample_curve` `reverse_curve` `subdivide_curve` `trim_curve` |
| Primitives | `arc` `bezier_segment` `curve_circle` `curve_line` `curve_spiral` `quadratic_bezier` `quadrilateral` `star` |
| 其他 | Read / Sample / Write / Topology / `construct_curves` |

### 2.6 Mesh（网格）

| 子组 | 节点 |
|------|------|
| Operations | `dual_mesh` `edge_paths_to_curves` `edge_paths_to_selection` `extrude_mesh` `flip_faces` `mesh_bevel` `mesh_boolean` `mesh_to_curve` `mesh_to_density_grid` `mesh_to_points` `mesh_to_sdf_grid` `mesh_to_volume` `scale_elements` `split_edges` `subdivide_mesh` `subdivision_surface` `triangulate` |
| Primitives | `cone` `cube` `cylinder` `grid` `icosphere` `mesh_circle` `mesh_line` `uv_sphere` |
| Topology | `corners_of_edge` `corners_of_face` `corners_of_vertex` `edges_of_corner` `edges_of_vertex` `face_of_corner` `offset_corner_in_face` `vertex_of_corner` |
| 其他 | Read / Sample / Write / UV |

新节点：`mesh_to_density_grid` `mesh_to_sdf_grid` `mesh_to_volume`（网格→体积网格转换，打通体积管线）、`edge_paths_to_curves`（边路径转曲线，做最短路径可视化）。

### 2.7 Point / Instances / Volume

- **Point**：`distribute_points_in_volume` `distribute_points_in_grid` `distribute_points_on_faces` `points` `points_to_curves` `points_to_sdf_grid` `points_to_vertices` `points_to_volume` `rasterize_points` `set_point_radius` `set_point_cloud_type`
- **Instances**：`instance_on_points` `instance_on_elements` `instances_to_points` `realize_instances` `rotate_instances` `scale_instances` `translate_instances` `set_instance_transform` `instance_bounds` `instance_reference` `instance_transform` `instance_rotation` `instance_scale` `randomize_transforms`
- **Volume**：Read / Sample / Write / Operations / Primitives（SDF 与密度网格完整体系）

新节点：`distribute_points_in_volume/grid` `rasterize_points` `points_to_sdf_grid`（体积内散布与栅格化）、`instance_on_elements` `randomize_transforms`、`set_point_cloud_type`。

### 2.8 Simulation（仿真区）

`simulation_zone` `xpbd_solver` `cloth_dynamics` `collider` `custom_effector` `custom_force` `hair_dynamics` `set_effector`

重大新增：几何节点内完整物理仿真——**XPBD 求解器**（位置约束动力学）、**布料/毛发动力学**、**碰撞体**、**自定义力/效应器**。Simulation Zone 提供跨帧状态记忆。

### 2.9 Generate / Hair / Normals / Grease Pencil

- **Generate**：`array` `curve_to_tube` `scatter_on_surface`
- **Hair**：Deformation / Generation / Guides / Read / Utility / Write（完整毛发节点族）
- **Normals**：`smooth_by_angle`
- **Grease Pencil**：Read / Write / Operations

新节点：`array`（阵列生成器）、`curve_to_tube`（曲线直接转管，省去 Curve to Mesh + 圆轮廓）、`scatter_on_surface`（高层散布封装）。

### 2.10 Color / Texture / Utilities

- **Color**：`blackbody` `color_ramp` `gamma` `mix_rgb` `rgb_curves` `combine_color` `separate_color`
- **Texture**：`brick` `checker` `gabor` `gradient` `image` `magic` `musgrave` `noise` `voronoi` `wave` `white_noise`（**`musgrave` 在 geo 仍保留**）
- **Utilities**：
  - Math / Text / Vector（同 Shader）
  - **Bundle / Closure / Field / List / Matrix / Rotation / Sound**（新数据类型子系统）
  - `for_each_geometry_zone` `repeat_zone` `random_value` `random_rotation` `implicit_conversion`
  - `index_switch` `menu_switch` `switch`
  - `deprecated/`（显式弃用节点归档）

重大新增：**For-Each Geometry Zone**（按元素迭代）、**List** 类型、**Matrix / Rotation / Sound** 一等数据、**Field** 显式操作。

---

## 三、Compositing Nodes（合成节点）

求值上下文：像素级，输入 `Image`（含 alpha）、`Value`、`Vector`；按 tile 分块并行求值于 Render Result/Viewer。

### 3.1 Input

`constant/` `blank_image` `bokeh_image` `group_input` `image` `image_info` `image_coordinates` `import_text` `mask` `movie_clip` `sequencer_strip_info` `string_to_image` `scene/`

新节点：`image_info` `image_coordinates` `import_text` `string_to_image` `sequencer_strip_info`（图像元数据与字符串图像互转，打通文字渲染管线）。

### 3.2 Output

`enable_output` `group_output` `viewer` `warning` `file_output`

### 3.3 Color

`adjust/` `alpha_convert` `alpha_over` `set_alpha` `combine_color` `separate_color` `depth_combine` `mix_color` `blackbody` `color_ramp` `convert_colorspace` `convert_to_display` `invert_color` `rgb_to_bw`

新节点：`depth_combine`（深度合成）、`convert_colorspace` `convert_to_display`（显式色彩管理）。

### 3.4 Creative（艺术效果，新分类）

`kuwahara` `pixelate` `posterize` `sepia` `split_toning` `tune_image` `unsharp_mask`

全新分类：油画/像素化/色调分离/复古/分调/调色/锐化，合成器内一站式风格化。

### 3.5 Filter

`blur/` `anti_aliasing` `convolve` `denoise` `despeckle` `dilate_erode` `inpaint` `mask_to_sdf` `filter` `glare`

新节点：`mask_to_sdf`（遮罩转 SDF，合成器内距离场运算）、`inpaint`（修补）、`convolve`（自定义卷积核）。

### 3.6 Keying / Mask / Tracking

- **Keying**：`channel_key` `chroma_key` `color_key` `color_spill` `difference_key` `distance_key` `keying` `keying_screen` `luminance_key`
- **Mask**：`cryptomatte` `cryptomatte_legacy` `box_mask` `ellipse_mask` `double_edge_mask` `id_mask`
- **Tracking**：`plane_track_deform` `stabilize_2d` `track_position`

### 3.7 Transform / Texture / Utilities / Camera & Lens Effects / Layout

- **Transform**：`rotate` `scale` `transform` `translate` `corner_pin` `crop` `displace` `flip` `map_uv` `lens_distortion` `movie_distortion`
- **Texture**：`brick` `checker` `gabor` `gradient` `magic` `noise` `voronoi` `wave` `white_noise`
- **Utilities**：math/text/vector、bundle/matrix/rotation、`implicit_conversion` `levels` `normalize` `random_value` `index_switch` `menu_switch` `switch` `switch_stereo_view` `split` `relative_to_pixel` `retime`
- **Camera & Lens Effects（新分类）**：`bloom` `chromatic_aberration` `film_grain` `sensor_noise` `vignette`
- **Layout** / groups

新节点：`retime`（重定时）、`relative_to_pixel`（相对/像素单位换算）、整个 **Camera & Lens Effects** 分类（真实镜头缺陷模拟）。

---

## 四、跨模块趋势分析（新版本架构演进）

| 趋势 | 证据节点 | 含义 |
|------|----------|------|
| 字符串一等公民 | Text 节点族（shader/geo/comp 全有）+ `import_text` `string_to_image` | 节点图可处理文本属性、文件名、格式化标签，打通"数据驱动材质" |
| Bundle 统一容器 | `combine/join/separate_bundle` 三模块皆有 | 替代多 socket 散连，打包传递复合数据 |
| 闭包作为数据 | `closure` `evaluate_closure` `light_accumulation` | 着色器可对 BSDF 采样/分支，为路径追踪自定义提供节点化入口 |
| 循环与状态 | `repeat` `repeat_zone` `simulation_zone` `for_each_geometry_zone` | DAG 限制突破，支持迭代细化与跨帧仿真 |
| 物理入节点图 | `xpbd_solver` `cloth_dynamics` `hair_dynamics` `collider` `custom_force` | 几何节点成为完整物理仿真环境，不再依赖独立 modifier |
| 体积/SDF 管线 | `mesh_to_sdf_grid` `mesh_to_density_grid` `points_to_sdf_grid` `rasterize_points` `mask_to_sdf` | SDF 成为几何/合成共用的隐式表示 |
| 交互式工具 | `mouse_position` `3d_cursor` `viewport_transform` `is_viewport` | 几何节点可构建响应鼠标的建模工具，等同 Maya 节点工具 |
| 矩阵/旋转/列表一等类型 | `matrix/` `rotation/` `list/` `field/` | 替代裸 vector/quat，变换与集合运算更规范 |
| 合成器风格化 | Creative + Camera & Lens Effects 两个新分类 | 合成器从"校正"转向"创意后期"，对标 Nuke/达芬奇 |
| 色彩管理显式化 | `convert_colorspace` `convert_to_display` `depth_combine` | 色彩空间不再是隐式全局设置，节点级可控 |
| 弃用归档 | geo `deprecated/` | 节点废弃不再静默删除，迁移路径可追溯 |

---

## 五、程序化材质工作流要点（基于新节点）

1. **属性驱动材质**：`store_named_attribute`（geo）→ `attribute`（shader）按名读取；用 `blur_attribute` 做属性空间平滑生成程序化磨损遮罩，避免依赖 UV。
2. **字符串资产选择**：`attribute`(string) → `menu_switch`/`index_switch` 按字符串切材质变体，实现"一图多材质"程序化。
3. **闭包分支**：`light_path` + `closure` + `evaluate_closure` 可按射线类型组合不同 BSDF（如仅反射用清漆，其余用基底）。
4. **体积材质**：`mesh_to_sdf_grid`（geo）→ `volume_principled`（shader），SDF 直接驱动体积密度，做程序化云/烟雾。
5. **仿真驱动**：`simulation_zone` + `xpbd_solver` 输出变形几何 → `capture_attribute` 存应变 → shader `attribute` 读取做应力着色。
6. **迭代细化**：`repeat_zone` 内对噪声纹理反复 `map_range` + `mix`，生成分形细节，替代单层 fBm。
7. **合成回写**：`file_output` 烘焙 Cryptomatte/深度 → `image` 节点回读做程序化景深合成，或导出供其他 DCC 使用。

---

## 六、Eevee 与 Cycles 能力差异（程序化材质相关）

| 特性 | Cycles | Eevee |
|------|--------|-------|
| `light_path` 射线类型分支 | 全支持 | 仅 `Is Camera Ray`，其余恒真/假 |
| True Displacement | 支持（需细分） | 不支持，仅 Bump |
| `subsurface` | 真实次表面 | 屏幕空间近似 |
| `closure`/`evaluate_closure` | 支持 | 受限 |
| `volume_principled`（异构） | 支持 | 单一近似 |
| `bevel`/`ao` 节点 | 支持 | `ao` 近似，`bevel` 不支持 |
| 透明叠加排序 | 路径追踪正确 | 屏幕空间近似，多层易错 |

程序化材质若依赖射线类型分支、真实置换、闭包采样，只能用 Cycles。