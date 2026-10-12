# Copyright (c) 2026 ByteDance Ltd. and/or its affiliates.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import gradio as gr
import spaces
import torch
import os
from PIL import Image
from diffusers.utils import load_image

# 导入你的两个 Pipeline
from dreamlite import DreamLitePipeline 
from dreamlite import DreamLiteMobilePipeline 

from huggingface_hub import snapshot_download

from transformers import CLIPFeatureExtractor
from diffusers.pipelines.stable_diffusion import StableDiffusionSafetyChecker
import numpy as np


# ==========================================
# 1. 全局配置与模型缓存管理
# ==========================================
HF_TOKEN = os.environ.get("HF_TOKEN")
device = "cuda"
dtype = torch.bfloat16

# 加载 safety checker（启动时加载一次）
safety_checker = StableDiffusionSafetyChecker.from_pretrained(
    "CompVis/stable-diffusion-safety-checker"
)
feature_extractor = CLIPFeatureExtractor.from_pretrained(
    "openai/clip-vit-base-patch32"
)

def check_safety(image):
    """检查生成的图像是否安全，返回 (image, is_nsfw)"""
    safety_input = feature_extractor(images=image, return_tensors="pt")
    np_image = np.array(image)
    _, has_nsfw = safety_checker(
        images=[np_image],
        clip_input=safety_input.pixel_values
    )
    return has_nsfw[0]

base_path = snapshot_download("carlofkl/DreamLite-base", token=HF_TOKEN)
mobile_path = snapshot_download("carlofkl/DreamLite-mobile", token=HF_TOKEN)

# 预加载两个模型到显存中，避免推理时动态加载
print("Loading DreamLite-base...")
pipe_base = DreamLitePipeline.from_pretrained(base_path, torch_dtype=dtype).to(device)
print("DreamLite-base Loaded Successfully!")

print("Loading DreamLite-mobile...")
pipe_mobile = DreamLiteMobilePipeline.from_pretrained(mobile_path, torch_dtype=dtype).to(device)
print("DreamLite-mobile Loaded Successfully!")

MODEL_CONFIGS = {
    "DreamLite-base": pipe_base,
    "DreamLite-mobile": pipe_mobile,
}

BASE_RESOLUTIONS = [
    "1024 × 1024 (1:1)",
    "1152 × 896 (9:7)",
    "896 × 1152 (7:9)",
    "1216 × 832 (3:2)",
    "832 × 1216 (2:3)",
    "1344 × 768 (16:9)",
    "768 × 1344 (9:16)",
]

def parse_resolution(res_str):
    """从分辨率字符串中解析宽高，例如 '1024 × 1024 (1:1)' -> (1024, 1024)"""
    parts = res_str.split("(")[0].strip().split("×")
    w = int(parts[0].strip())
    h = int(parts[1].strip())
    return w, h

# ==========================================
# 2. 定义推理函数
# ==========================================
@spaces.GPU
def generate_image(
    model_choice,
    prompt,
    image,
    resolution,
    num_inference_steps,
    guidance_scale,
    image_guidance_scale,
    seed
):
    # 从预加载的模型中选择
    pipe = MODEL_CONFIGS[model_choice]

    # 强制将种子转为 Tensor Generator 以保证可复现
    generator = torch.Generator(device="cpu").manual_seed(seed)
    
    # 将 Gradio 传入的图片 (如果有的话) 转换为 PIL 格式
    input_image = image if image is not None else None

    if model_choice == "DreamLite-base":
        width, height = parse_resolution(resolution)
    else:
        # Mobile 版本固定 1024x1024
        width, height = parse_resolution(resolution)
    
    if image is not None: width, height = image.size
    
    # 调用对应的 Pipeline
    out = pipe(
        prompt=prompt,
        image=input_image,
        width=width,
        height=height,
        guidance_scale=guidance_scale,
        image_guidance_scale=image_guidance_scale,
        num_inference_steps=num_inference_steps,
        generator=generator,
    ).images[0]

    if out.size != (width, height):
        out = out.resize((width, height), resample=Image.LANCZOS)

    # Safety Check
    if check_safety(out):
        raise gr.Error("⚠️ The generated image has been blocked by our safety filter. "
                       "Please try a different prompt.")
    
    return out

# ==========================================
# 3. UI 联动：切换模型时更新参数面板
# ==========================================
def on_model_change(model_choice):
    """
    切换模型时自动调整 UI 组件：
    - Base: 显示分辨率选择，默认 28 步
    - Mobile: 隐藏分辨率选择（固定 1024×1024），默认 4 步
    """
    if model_choice == "DreamLite-base":
        return (
            gr.update(visible=True, value="1024 × 1024 (1:1)"),  # 分辨率选择可见
            gr.update(value=28),                                   # 默认 28 步
            gr.update(value=3.5),                                  # guidance scale
        )
    else:
        return (
            gr.update(visible=True, value="1024 × 1024 (1:1)"),    # 分辨率选择隐藏
            gr.update(value=4),                                    # 默认 4 步
            gr.update(value=1.0),                                  # guidance scale
        )

# ==========================================
# 4. 搭建 Gradio 页面
# ==========================================
with gr.Blocks(title="DreamLite Demo") as demo:
    gr.Markdown("# 🌟 DreamLite: Efficient On-Device Generation and Editing")
    gr.Markdown("Select a model version, then generate images from text or upload an image to edit it based on instructions.")
    
    with gr.Row():
        with gr.Column():
            # 新增：模型选择下拉框
            model_dropdown = gr.Dropdown(
                choices=list(MODEL_CONFIGS.keys()),
                value="DreamLite-base", # 默认选中 base
                label="Select Model Version",
                interactive=True
            )
            
            # 输入组件
            prompt_input = gr.Textbox(label="Prompt / Instruction", placeholder="e.g. A photo of a dog...", lines=3)
            image_input = gr.Image(type="pil", label="Input Image (Optional for Editing)")

            # 分辨率选择（仅 Base 版本可见）
            resolution_dropdown = gr.Dropdown(
                choices=BASE_RESOLUTIONS,
                value="1024 × 1024 (1:1)",
                label="Resolution (Base model only, Mobile fixed at 1024×1024)",
                interactive=True,
                visible=True
            )
            
            with gr.Accordion("Advanced Options", open=False):
                steps_slider = gr.Slider(minimum=1, maximum=50, value=28, step=1, label="Inference Steps")
                guidance_slider = gr.Slider(minimum=0.0, maximum=20.0, value=3.5, step=0.1, label="Guidance Scale")
                img_guidance_slider = gr.Slider(minimum=0.0, maximum=5.0, value=1.0, step=0.1, label="Image Guidance Scale")
                seed_slider = gr.Slider(minimum=0, maximum=999999, value=42, step=1, label="Seed")
                
            submit_btn = gr.Button("Generate / Edit", variant="primary")
            
        with gr.Column():
            # 输出组件
            output_image = gr.Image(type="pil", label="Output Image")
            
    # 模型切换时联动更新 UI
    model_dropdown.change(
        fn=on_model_change,
        inputs=[model_dropdown],
        outputs=[resolution_dropdown, steps_slider, guidance_slider]
    )

    # 绑定点击事件 (注意 inputs 列表增加了 model_dropdown 作为第一个参数)
    submit_btn.click(
        fn=generate_image,
        inputs=[model_dropdown, prompt_input, image_input, resolution_dropdown, steps_slider, guidance_slider, img_guidance_slider, seed_slider],
        outputs=[output_image]
    )
    
    # 示例区 (同步加上对应的模型选择)
    gr.Examples(
        examples=[
            ["DreamLite-base", "A close-up of a fire spitting dragon, cinematic shot.", None, "1216 × 832 (3:2)", 28, 3.5, 1.0, 123],
            ["DreamLite-mobile", "A portrait of a young woman with flowers.", None, "1024 × 1024 (1:1)", 4, 3.5, 1.0, 42],
            ["DreamLite-mobile", "Make it look like a pencil sketch", "assets/example.png", "1024 × 1024 (1:1)", 4, 1.0, 1.0, 42],
        ],
        inputs=[model_dropdown, prompt_input, image_input, resolution_dropdown, steps_slider, guidance_slider, img_guidance_slider, seed_slider]
    )

# ==========================================
# 5. 启动应用
# ==========================================
if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)