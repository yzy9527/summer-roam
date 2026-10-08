# copper-cow

该目录保留本物种的可编辑制作源与制作脚本。

| 文件 | 用途 |
| --- | --- |
| copper-cow.blend | 静态模型源 |
| copper-cow-rigged.blend | 骨骼与蒙皮源 |
| build.py | 静态模型制作入口 |
| rig.py | 调用共享骨骼工具并导出运行模型 |

共享工具位于 [animals](../animals/)，运行模型为 `src/assets/models/copper-cow/copper-cow-rigged.glb`。制作脚本需要 Blender 的 Python 环境。保留静态源，再修改骨骼和导出；使用实际 GLB 测试及浏览器检查验证效果。

参见 [开发说明](../../docs/development.md) 与 [资源来源及许可](../ASSETS.md)。
