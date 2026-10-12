---
license: cc-by-nc-4.0
library_name: diffusers
pipeline_tag: text-to-image
---

# Requirements 
This pipeline relies on `Qwen3VLForConditionalGeneration` / `Qwen3VLProcessor`. Due to upstream changes in `transformers >= 5.0`, you must pin:
```bash                                                                                                                                                     
pip install "transformers==4.57.3"                                                                                                                          
```

Using `transformers >= 5.0` will produce visible block-pattern artifacts in the generated image.  

# DreamLite

ByteDance's UNet-based text-to-image and image-edit diffusion model.
3-branch dual-CFG design, runs at 1024×1024.

```python
import torch
from diffusers import DreamLitePipeline

pipe = DreamLitePipeline.from_pretrained(
    "carlofkl/DreamLite-base", torch_dtype=torch.bfloat16
).to("cuda")
image = pipe("a corgi astronaut", num_inference_steps=28).images[0]
```

License: CC BY-NC 4.0 (non-commercial). A full model card will be added once
the diffusers integration PR is merged.