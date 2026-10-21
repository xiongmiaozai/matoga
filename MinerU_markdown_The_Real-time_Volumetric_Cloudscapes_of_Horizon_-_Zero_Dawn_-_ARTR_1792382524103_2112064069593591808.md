![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/4979e7201d432ca0fe4b7291a31363bb54ddcc098fbc03c979093f1ea5f162a1.jpg)


For slides with proper formatting and video/audio use the PPTX version. 

The following was presented at SIGGRAPH 2015 as part of the Advances in Real-time rendering Course. http://advances.realtimerendering.com 

Authors: Andrew Schneider – Principal FX Artist, Nathan Vos – Principal Tech Programmer 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/8b10f5fb34a7efb3e8540ebc487fd6bef829071cc93168bfde68fc817b555c57.jpg)


VOLUMETRIC CLOUDSRCAPL-TOF HORIZON: ZERO DAWN 

ANDREW SCHNEIDER | PRINCIPAL FX ARTIST 

ADVANCESIN REAL-TIME RENDERING 2015SIGGRAPH20154 

Thank you for coming. 

Over the next half hour I am going to be breaking down and explaining the cloud system for Horizon Zero Dawn. 

As Natasha mentioned, my background is in Animated film VFX, with experience programming for voxel systems including clouds. 

This was co-developed between myself and a programmer named Nathan Vos. He could not be here today, but his work is an important part of what we were able to achieve with this. 

Horizon was just announced at E3 this year, and this is the first time that we are sharing some of our new tech with the community. What you are seeing here renders in about 2 milliseconds, takes 20 mb of ram and completely replaces our asset based cloud solutions in previous games. 

Before I dive into our approach and justification for those 2 milliseconds, let me give you a little background to explain why we ended up developing a procedural 

volumetric system for skies in the first place. 

In the past, Guerrilla has been known for the KILLZONE series of games, which are first person shooters . 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/4830a04d49c9ef814012789caed79d05c3948956e069d5a2d8d9378354f636e2.jpg)


FPS usually restrict the player to a predefined track, which means that we could hand place elements like clouds using billboards and highly detailed sky domes to create a heavily art directed sky. 

These domes and cards were built in Photoshop by one artist using stock photography. As Time of day was static in the KILLZONE series, we could pre-bake our lighting to one set of images, which kept ram usage and processing low. 

By animating these dome shaders we could create some pretty detailed and epic sky scapes for our games. 

Horizon is a very different kind of game… 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/1415e5e43715c3deafc790b19ea0044a1ce633fb7481d4eca54c38d3064ec6ee.jpg)


Horizon trailer 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/45037099e9d8cff81b053de3aed467eca0e1992f48a5a219d7aea98084ce77db.jpg)


## The World of Horizon

Open World -the player can traverse large distances 

Day /Night Cycle 

Dynamic Weather 

Epic Scenery- Mountains, Forests, Lakes 

Skies - Part of the landscape 

## IN-GAME RENDER

So, from that you could see that we have left the world of Killzone behind. 

• Horizon is a vastly open world where you can pretty much go anywhere that you see, including the tops of mountains. 

• Since this is a living real world, we simulate the spinning of the earth by having a time of day cycle. 

• Weather is part of the environment so it will be changing and evolving as well. 

• There’s lots of epic scenery: Mountains, forests, plains, and lakes. 

• Skies are a big part of the landscape of horizon. They make up half of the screen. Skies are also are a very important part of storytelling as well as world building. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/6a38d5f4a1f866219dbb3e15a0a78680563e4a2f7b82763bf9c352df87e474e5.jpg)


They are used to tell us where we are, when we are, and they can also be used as thematic devices in storytelling. 

## Cloud Goals

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/7e5856fdcf051b9d7d733c2d6a5f626075f246b8c568b62bf91e9806444d4aa3.jpg)


## IN-GAME RENDER

For Horizon, we want the player to really experience the world we are building. So we decided to try something bold. We prioritized some goals for our clouds. 

• Art direct-able 

• Realistic Representing multiple cloud types 

• Integrate with weather 

• Evolve in some way 

• And of course, they needed to be Epic! 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/a25a1970e0a3e822359cc9439b75a8c4a920b132d35fff529123ac93801f1bd8.jpg)


Realistic CG clouds are not an easy nut to crack. So, before we tried to solve the whole problem of creating a sky full them, we thought it would be good to explore different ways to make and light individual cloud assets. 

## Early Cloud Explorations

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/368f270c796d30fce245c64e73fde57cb9b10d341666d8152fc25c6fba083584.jpg)


• Our earliest successful modeling approach was to use a custom fluid solver to grow clouds. The results were nice, but this was hard for artists to control if they had not had any fluid simulation experience. Guerrilla is a game studio after all. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/11be4e9463f4c947f337fc008e7e49a2717598160db5faa9cdb5899e96ff0d6c.jpg)


We ended up modeling clouds from simple shapes, 

• voxelizing them and then … 

• Running them through our fluid solver … 

• Until we got a cloud like shape . 

HOUDINI VIEWPORT 

# Early Cloud Explorations

Simulated Shapes 

Custom Lighting Model 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/c4aa83b907e0ce8b1f13e3d788ee71dc5a627a98fc8a970bbd7e2c805a3f924d.jpg)


And then we developed a lighting model that we used to pre-compute primary and secondary scattering, 

• Ill get into our final lighting model a little later, but the result you see here is computed on the cpu in Houdini in 10 seconds. 

HOUDINI VIEWPORT 

## Early Cloud Explorations

Simulated Shapes 

Custom Lighting Model 

In-Game Representations 

Poly Clouds 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/74ad119c8cce743029b2055266c142d36946523531d501324d66243268a8574b.jpg)


We explored 3 ways to get these cloud assets into game. 

• For the first, we tried to treat our cloud as part of the landscape, literally modeling them as polygons from our fluid simulations and baking the lighting data using spherical harmonics. This only worked for the thick clouds and not whispy ones … 

So, we though we should try to enhance the billboard approach to support multiple orientations and times of day . We succeeded but we found that we couldn’t easily re-produce inter cloud shadowing. So… 

## Early Cloud Explorations

Simulated Shapes 

Custom Lighting Model 

In-Game Representations 

Poly Clouds 

Billboards 

Sky Domes 

× Evolution × Overhead clouds × Performance 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/c33d3a9d350a868403f45eac54815064c13c55287ca26a14f5979c985ce0ed61.jpg)



HOUDINI /IN-GAME RENDER


• We tried rendering all of our voxel clouds as one cloud set to produce skydomes that could also blend into the atmosphere over depth. Sort of worked. 

• At this point we took a step back to evaluate what didn’t work. None of the solutions made the clouds evolve over time. There was not a good way to make clouds pass overhead. And there was high memory usage and overdraw for all methods. 

• So maybe a traditional asset based approach was not the way to go. 

Well, What about voxel clouds? 

OK we are crazy we are actually considering voxel clouds now… 

As you can imagine this idea was not very popular with the programmers. 

• Volumetrics are traditionally very expensive 

• With lots of texture reads 

• Ray marches 

• Nested loops 

• However, there are many proven methods for fast, believable volumetric lighting 

• There is convincing work to use noise to model clouds . I can refer you to the 2012 Production Volume Rendering course. 

• Could we solve the expense somehow and benefit from all of the look advantages of volumetrics? 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/f51c35598389810cb1bed64b4c60dcf1313932b5b1377a8bd2ece06016a07b2c.jpg)


Our first test was to stack up a bunch of polygons in front of the camera and sample 3d Perlin noise with them. While extremely slow, This was promising, but we want to represent multiple clouds types not just these bandy clouds. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/633103290abdd9c352b5ef1cc23134ff064ddb0e677b73cf0bd7fa85949be5bb.jpg)


So we went into Houdini and generated some tiling 3d textures out of the simulated cloud shapes. Using Houdini’s GL extensions, we built a prototype GL shader to develop a cloud system and lighting model. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/998f17dec1b0ccfe626b67091078eb88b16c39bd2aeea8a23f60fdd56ee273c8.jpg)


In The end, with a LOT of hacks, we got very close to mimicking our reference. However, it all fell apart when we put the clouds in motion. It also took 1 second per frame to compute. For me coming from animated vfx, this was pretty impressive, but my colleagues were still not impressed. 

So I thought, Instead of explicitly defining clouds with pre determined shapes, what if we could develop some good noises at lower resolutions that have the characteristics we like and then find a way to blend between them based on a set of rules. There has been previous work like this but none of it came close to our look goals. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/a8a65a2b714c4c6985b52ac06be7139287bd8cf36c9ccbe13a8f416bb4a0b695.jpg)


This brings us to the clouds system for horizon. To explain it better I have broken it down into 4 sections: Modeling, Lighting, Rendering and Optimization. 

Before I get into how we modeled the cloud scapes, it would be good to have a basic understanding of what clouds are and how they evolve into different shapes. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/8c925607a0dfb05039ca7a2731b0b5f9a7c9f741ed700b5e156f6be8cbb6cb63.jpg)


Classifying clouds helped us better communicate what we were talking about and 

• Define where we would draw them. The basic cloud types are as follows. 

• The strato clouds including stratus, cumulus and stratocumulus 

• The alto clouds, which are those bandy or puffy clouds above the strato layer 

• And the cirro clouds those big arcing bands and little puffs in the upper atmosphere. 

• Finally there is the granddaddy of all cloud types, the Cumulonimbus clouds which go high into the atmosphere. 

• For comparison, mount Everest is above 8,000 meters. 

## Modeling

■ Density increases at lower temperatures 

■ Temperature decreases over altitude 

■ High densities precipitate as rain or snow 

■Wind direction varies over altitude 

They rise with heat from the earth 

Dense regions make round shapes as they rise 

■ Light regions diffuse like fog 

Atmospheric turbulence further distorts clouds. 

by Roger Clausse and Léopold Facy 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/7a81e7180364ff9af50c97c46e1faa40b5c822f6813569a42bf74fd89141419f.jpg)


After doing research on cloud types, we had a look into the forces that shape them. The best source we had was a book from 1961 by two meteorologists, called “The Clouds” as creatively as research books from the 60’s were titled. What it lacked in charm it made up for with useful empirical results and concepts that help with modeling a cloud system. 

Density increases at lower temperatures 

Temperature decreases over altitude 

High densities precipitate as rain or snow 

Wind direction varies over altitude 

They rise with heat from the earth 

Dense regions make round shapes as they rise 

Light regions diffuse like fog 

 Atmospheric turbulence further distorts clouds. 

These are all abstractions that are useful when modeling clouds. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/f6f2cbe48fd43810c954aa5379520742fe5943d2fe86a48f7eacdc5fc62f82b1.jpg)



Our modeling approach uses ray marching to produce clouds.


• We march from the camera and sample noises and a set of gradients to define our cloud shapes using a sampler 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/44a78d6bc3ae8e4b944654f8155414a2edc767cce7d3ce4f077569c03c487c6c.jpg)


In a ray march you use a sampler to… 

• Build up an alpha channel…. 

• And calculate lighting 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/a797944082e98bb20fe30cc215169726113374b5070525b0ac224d5330512694.jpg)


There are many examples of real-time volume clouds on the internet. The usual approach involves drawing them in a height zone above the camera using something called fBm, Fractal Brownian Motion. This is done by layering Perlin noises of different frequencies until you get something detailed. 

## (pause)

• This noise is then usually combined somehow with a gradient to define a change in cloud density over height. 

SHADERTOY VIEWPORT 

## Modeling

fBm – fractal Brownian motion 

■ Layered Perlin Frequencies 

Height Gadient 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/e5cc568a8aadf6640a24c70a1f5769baf710cc8ecbc9e43c0602122121a8407b.jpg)


This makes some very nice but very procedural looking clouds. What’s wrong? There are no larger governing shapes or visual cues as to what is actually going on here. We don’t feel the implied evolution of the clouds from their shapes. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/ee580d697fa651327c475aacc4dfce35c712905a3f04b036c698f14499fe001b.jpg)


By contrast, in this photograph we can tell what is going on here. These clouds are rising like puffs of steam from a factory. Notice the round shapes at the tops and whispy shapes at the bottoms. 

## Modeling

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/eb8275279c0527fc3dea968063ba3a00ec69bdf6d57bf7a572cc4be57ddbdfeb.jpg)



SHADERTOY VIEWPORT


This fBm approach has some nice whispy shapes, but it lacks those bulges and billows that give a sense of motion. We need to take our shader beyond what you would find on something like ShaderToy. 

## Modeling

Round shapes- billowing 

Packed, Cauliflower like 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/c2316d9b219a5202beec2d9035c130e868af471c094d7d5760f02b370bd31776.jpg)


• These billows, as Ill call them… 

• …are packed, sometimes taking on a cauliflower shape. 

Since Perlin noise alone doesn’t cut it, we developed our own layered noises. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/b9696be449ce14fb91b71f0cd13069141c2a4d3619b24b904c7c8b5275f5e4c1.jpg)


## Modeling

Worley Noise – Steven Worley, 1996 

Packed billowed shapes 

Layered like fBm 

Used to dilate Perlin Noise 

Perlin-Worleynoise. 

Worley noise was introduced in 1996 by Steven Worley and is often used for caustics and water effects. If it is inverted as you see here: 

• It makes tightly packed billow shapes. 

• We layered it like the standard Perlin fBm approach 

• Then we used it as an offset to dilate Perlin noise. this allowed us to keep the connectedness of Perlin noise but add some billowy shapes to it. 

• We referred to this as `Perlin-Worley` noise 

## Modeling

Using noise in real-time shaders 

Noises stored as textures 

As few texture reads as possible 

Lower resolutions when possible 

Our noises 

2 3D Textures 

1 2D Texture 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/7df9526d676d270b16133c7dcfeca89f4d4d62260c105285367a1b2532e4c750.jpg)


• In games, it is often best for performance to store noises as tiling 3d textures. 

• You want to keep texture reads to a minimum… 

• and keep the resolutions as small as possible. 

• In our case we have compressed our noises to… 

• two 3d textures… 

• And 1 2d texture. 

## Modeling

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/1d95816c11e8bf6a76b35e6a6f4dfd58b5b1c59f3eb5e198da234c9de839f3c4.jpg)


• The first 3d Texture… 

• has 4 channels… 

• it is 128^3 resolution… 

• The first channel is the Perlin - Worley noise I just described. 

• The other 3 are Worley noise at increasing frequencies. Like in the standard approach, This 3d texture is used to define the base shape for our clouds. 

## Modeling

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/e062d4274eb8f4975c772292cbb1efbfea54375426e3802b5f991281e7a1d174.jpg)


• Our second 3d texture… 

• has 3 channels… 

• it is 32^3 resolution… 

• and uses Worley noise at increasing frequencies. This texture is used to add detail to the base cloud shape defined by the first 3d noise. 

## Modeling

2D Texture 

3 Channels 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/9cbe03c811f57c6e359f7388ecb6c8ecee62cf64551dc4fdbf66620d75070c50.jpg)


• Our 2D texture… 

• has 3 channels… 

• it is 128^2 resolution… 

• and uses curl noise. Which is non divergent and is used to fake fluid motion. We use this noise to distort our cloud shapes and add a sense of turbulence. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/568b947e021a4928841e781f4800e445c2bec6282c02cc7deb00edec98993d8b.jpg)


• Recall that the standard solution calls for a height gradient to change the noise signal over altitude. Instead of 1, we use… 

• 3 mathematical presets that represent the major low altitude… 

• cloud types when we blend between them at the sample position. 

• We also have a value telling us how much cloud coverage we want to have at the sample position. This is a value between zero and 1. 

## Modeling

1. Sample 3dTexture1 & Multiply this by the height signal to build low resolution cloud 

2. Erode and multiply the result by a coverage signal (0 to 1) and reduce density at the base of the cloud 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/fe52227f2ca93a7f041623d69da90860885df518aa6b5e21bd282b5c28880a0f.jpg)


What we are looking at on the right side of the screen is a view rotated about 30 degrees above the horizon. We will be drawing clouds per the standard approach in a zone above the camera. 

• First, we build a basic cloud shape by sampling our first 3dTexture and multiplying it by our height signal. 

• The next step is to multiply the result by the coverage and reduce density at the bottoms of the clouds. 

## Modeling

1. Sample 3dTexture1 & Multiply this by the height signal to build low resolution cloud 

2. Erode and multiply the result by a coverage signal (0 to 1) and reduce density at the base of the cloud 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/af13f3fcf3e0d90e97c68dbe648e32e734234559037ee0cf3f758af3da727729.jpg)


This ensures that the bottoms will be whispy and it increases the presence of clouds in a more natural way. Remember that density increases over altitude. Now that we have our base cloud shape, we add details. 

## Modeling

1. Sample 3DTexture1 & Multiply this by the height signal to build low resolution cloud 

2. Erode and multiply the result by a coverage signal (0 to 1) and reduce density at the base of the cloud 

3. Sample 3DTexture2 & erode the base cloud at its edges 

4. Distort 3DTexture2 by 2D curl noise 

base cloud shape (edges) 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/817ac95f36da8df3665a8430195aca13a16c92f7f67d6162659b73eb26ad37c4.jpg)


X curl noise ) 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/c3ffa82ef312b3ae23f69c1982134fe3c86a6095f142cba06545cbeca985633b.jpg)



IN-GAME RENDER


The next step is to… 

• erode the base cloud shape by subtracting the second 3d texture at the edges of the cloud. Little tip, If you invert the Worley noise at the base of the clouds you get some nice whispy shapes. 

• We also distort this second noise texture by our 2d curl noise to fake the swirly distortions from atmospheric turbulence as you can see here… 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/e0541e5ce34284cd466c6d037778f8be113cbd3dc8a74d6e3c3bcc185193611a.jpg)


Here’s that it looks like in game. I’m adjusting the coverage signal to make them thicker and then transitioning between the height gradients for cumulus to stratus. 

Now that we have decent stationary clouds we need to start working on making them evolve as part of our weather system. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/50580bcc7501ae5c5e0fa7b690737f07284808796f87253e4e5ede84e068e7c7.jpg)


These two controls, cloud coverage and cloud type are a FUNCTION of our weather system. 

• There is an additional control for Precipitation that we use to draw rain clouds. 

## Modeling

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/52cef997db8988cb3c5d144540492d9a312bad4296e482fa2675d85a71ab4bea.jpg)


Here in this image you can see a little map down in the lower left corner. This represents the weather settings that drive the clouds over our section of world map. The pinkish white pattern you see is the output from our weather system. Red is coverage, Green is precipitation and blue is cloud type. The weather system modulates these channels with a simulation that progresses during gameplay. The image here has Cumulus rain clouds directly overhead (white) and regular cumulus clouds in the distance. We have controls to bias the simulation to keep things art direct-able in a general sense. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/2ce65faceeefbd26df7531e7e3bfcabe5849c3d95a70cb8a169d389147cfbaa8.jpg)


The default condition is a combination of cumulus and stratus clouds. The areas that are more red have less of the blue signal, making them stratus clouds. You can see them in the distance at the center bottom of the image. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/68827ee08255944370bdb6e5d622983c568c0bca17fee9f9dadd0abb31799fa5.jpg)


The precipitation signal transitions the map from whatever it is to cumulonimbus clouds at 70% coverage. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/b4d0689664e2d7cde93aa24d665a2fb5194cf22c02d60d66888f61e4986ec39a.jpg)



The precipitation control not only adjusts clouds but it creates rain effects. In this video I am increasing the chance of precipitation gradually to 100%


![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/54f30a82b2e5af8160002bf94c3434aa1876d61ab6027928c583f6c92774d510.jpg)


If we increase the wind speed and make sure that there is a chance of rain, we can get Storm clouds rolling in and starting to drop rain on us. This video is sped up, for effect, btw. Ahhh… Nature Sounds. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/7e36add8d5f98219da77af32f34a5953cced74131e743a5338cd9d600bd71e57.jpg)


• We also use our weather system to make sure that clouds are the horizon are always interesting and poke above mountains. 

• We draw the cloudscapes within a 35,000 meter radius around the player…. 

• and Starting at a distance of 15,000 meters… 

• we start transitioning to cumulus clouds at around 50% coverage. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/42e5e9ad9220948f467a89569fc4cc0d799dfdf5faf6009b3fd89aa026263a97.jpg)



This ensures that there is always some variety and ‘epicness’ to the clouds on the horizon.


So, as you can see, the weather system produces some nice variation in cloud type and coverage. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/7c82e4a4d87f9d199f7759e007457675ece7a7201137098edcf2c91bfaded4b6.jpg)


In the case of the e3 trailer, We overrode the signals from the weather system with custom textures. You can see the corresponding textures for each shot in the lower left corner. We painted custom skies for each shot in this manner. 

## Modeling

Ray March / Sampler 

2 Levels of detail 

LF Base cloud shape 

HF Detail and distortion 

Custom noises made from Perlin, Worley and Curl noise 

Density modulated by height signals and coverage signal 

Driven by weather simulation / User input 

Animated 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/8bec499bd59a4b805334c23363a0eb1b178937d2fe844e85468f8b4fbaf20863.jpg)


## IN-GAME RENDER

So to sum up our modeling approach… 

we follow the standard ray-march/ sampler framework 

but we build the clouds with two levels of detail 

a low frequency cloud base shape 

and high frequency detail and distortion 

Our noises are custom and made from Perlin, Worley and Curl noise 

We use a set of presets for each cloud type to control density over height and cloud coverage 

These are driven by our weather simulation or by custom textures for use with cutscenes 

and it is all animated in a given wind direction. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/698c36b70d0e5178b35e1867dc1434cad83c7c2d960ed85ec4e787eeedc138e1.jpg)


Cloud lighting is a very well researched area in computer graphics. The best results tend to come from high numbers of samples. In games, when you ask what the budget will be for lighting clouds, you might very well be told “Zero”. We decided that we would need to examine the current approximation techniques to reproduce the 3 most important lighting effects for us. 

## Lighting Goals

Directional Scattering 

Silver Lining 

Dark Edges 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/302eb09be790c4e160d4dde37f2840382c98376b0b19a9675d7ca132801a5cfb.jpg)


• The directional scattering or luminous quality of clouds… 

• The sliver lining when you look toward the sun through a cloud… 

• And the dark edges visible on clouds when you look away from the sun. The first two have standard solutions but the third is something we had to solve ourselves. 

## Lighting

Out-scattering 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/d023847d999e63748dd0c7cce7e701aa66982ab5b337e89e50c41ebf2aaa6238.jpg)


Absorption 

In-scattering 

C ADVANCES IN REAL - PHYSICALLY BASED RENDERING FROM THEORY TO IMPLEMENTATION, PHARR & HUMPHRIES 

When light enters a cloud 

• The majority of the 

• light rays spend their 

• time refracting 

• off of water 

• droplets and 

• ice inside of 

• the cloud 

• before heading 

• to our eyes. 

## (pause)

• By the time the light ray finally exits the cloud it could have been out scattered… 

• absorbed by the cloud… 

• or combined with… 

• other light rays in what is called in-scattering.. 

In film vfx we can afford to spend time gathering light and accurately reproducing this, but in games we have to use approximations. These three behaviors can be thought of as probabilities and there is a 

Standard way to approximate the result you would get. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/8c0b970e265d867c25f8000d07b2eadefcaf8735dd5fd63d749675513834dd99.jpg)


Beer’s law states that we can determine the amount of light reaching a point based on the optical thickness of the medium that it travels through. With Beers law, we have a basic way to describe the amount of light at a given point in the cloud. 

• If we substitute energy for transmittance ad depth in the cloud for thickness, and draw this out you can see that energy exponentially decreases over depth. This forms the foundation of our lighting model. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/72ec1e396e45a8e9ff7239ae67dec52b98c0a91827418a86d22a462049166e7b.jpg)


but there is a another component contributing to the light energy at a point. It is the probability of light scattering forward or backward in the cloud. This is responsible for the silver lining in clouds, one of our look goals. 

## Lighting

Anisotropic Scattering 

Henyey-Greenstein Model 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/30959bde10fde4ab3847c18af16e2c8b70f998fe61140e2940dfefdd75766565.jpg)



PRODUCTION VOLUME RENDERING, WRENNINGE


• In clouds, there is a higher probability of light scattering forward. This is called Anisotropic scattering. 

• In 1941, the Henyey-Greenstein model was developed to help astronomers with light calculations at galactic scales, but today it is used to reliably reproduce Anisotropy in cloud lighting. 

## Lighting

Beer's Law 

Henyey-Greenstein Function 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/f3021580983c782799106a98a8425351ea7335df5a7e73f81bcd8cfa220e5589.jpg)



PRODUCTION VOLUME RENDERING, WRENNINGE


Each time we sample light energy, we multiply it by The Henyey-Greenstein phase function. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/d2ed98ad0369561f7b9b68c470ac47f120735300e22541089682f113ca8b882a.jpg)


Here you can see the result. On the left is Just the beers law portion of our lighting model. On the right we have applied the Henyey-Greenstein phase function. Notice that the clouds are brighter around the sun on the right. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/1c19d58e6433a4eec12905553f8065090a615e09da7e17706f3cfa6bfb40f160.jpg)


But we are still missing something important, something that is often forgotten. The dark edges on clouds. This is something that is not as well documented with solutions so we had to do a thought experiment to understand what was going on. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/e794df48365137598a9e8886fc5e2d61950523e32db691a458b1fd6fba49cd2c.jpg)


Think back to the random walk of a light ray through a cloud. 

• If we compare a point inside of the cloud to one near the surface, the one inside would receive more in scattered light. In other words, Cloud material, if you want to call it that, is a collector for light. The deeper you are in the surface of a cloud, the more potential there is for gathered light from nearby regions until the light begins to attenuate, that is. 

• This is extremely pronounced in round formations on clouds, so much so that the crevices appear… 

• to be lighter that the bulges and edges because they receive a small boost of inscattered light. 

Normally in film, we would take many many samples to gather the contributing light at a point and use a more expensive phase function. You can get this result with brute force. If you were in Magnus Wrenninge’s multiple scattering talk yesterday there was a very good example of how to get this. But in games we have to find a way to approximate this. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/ced6cd6f0ceaf3b45bfa52a86b45edf20bbb2a41d02997b17ce656d9c10acbc3.jpg)


A former colleague of mine, Matt Wilson, from Blue Sky, said that there is a similar effect in piles of powdered sugar. So, I’ll refer to this as the powdered sugar look. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/59e7bb41f09cb7f7e16e0621393d3d81977d307f5e0e1a184e5c77be386bb32e.jpg)


Once you understand this effect, you begin to see it everywhere. It can not be unseen. Even in light whispy clouds. The dark gradient is just wider. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/17f0ed1ce25c46931b2fdf88bc427d4fa1fba69d90f1c231d5dec65d9e011128.jpg)


The reason we do not see this effect automatically is because our transmittance function is an approximation and doesn’t take it into account. 

• The surface of the cloud is always going to have the same light energy that it receives. Lets think of this effect as a statistical probability based on depth. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/5f49d95f1974156da605c1a30778d6ff2dfdd6a605d38acc5464e4e34fd7ef08.jpg)


As we go deeper in the cloud, our potential for in scattering increases and more of it will reach our eye. 

• If you combine the two functions you get something that describes this… 

• effect as well as the traditional approach. 

I am still looking for the Beer’s-Powder approximation method in the ACM digital library and I haven’t found anything mentioned with that name yet. 

No Lighting 

Beer's Law 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/80e475883b60a46ebb18db822856dbb40b153b7cbe6bb31c752b054fab249090.jpg)


Powder Effect 

'Beer's-Powder' Effect 

Lets visually compare the components of our directional lighting model 

• The beer’s law component which handles the primary scattering… 

• the powder sugar effect which produces the dark edges facing the light… 

• And their combination in our final result. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/8dfd1919c3d87afa6e405dca191755b2d493379c518e7cefec2b1c3a06e2efbe.jpg)



Here you can see what the beer’s law and combined beer’s law and powder effect look like when viewed from the light source. This is a pretty good approximation of our reference.


![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/23aa9f3519fa137197bf2ec95b25aa84676889e59e5a25b4a78a221dd30a14af.jpg)


In game, it adds a lot of realism to the 

• thicker clouds and helps sell the scale of the scene. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/00f173de5c5495b926dabee38ee79f99d5100155644eaf6e7d54907bcb2ea334.jpg)


But we have to remember that this is a view dependent effect. We only see it where our view vector approaches the light vector, so the powder function should account for this gradient as well. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/3b9afaa122dff3c04b4d3ea892744ce96e04d0ee1db5a1c42a4bbc7f976c74de.jpg)



Here is a panning camera view that shows this effect increasing as we look away from the sun.


![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/047233822601429a0b73dd73891653c61652bc2062b44f269c481dc76030d1e8.jpg)


The last part of our lighting model is that we artificially darken the rain clouds by … • increasing the light absorption where they exist. 

## Lighting

Beer's Law 

Henyey-Greenstein Function 

Powder Effect 

Absorption Increases for Rain clouds. 

Energy = e − d*r * HG * P 

So, in review our model has 3 components: 

• Beer’s Law 

• Henyen-Greenstein 

• our powder sugar effect 

• And Absorption increasing for rain clouds 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/7a9c88c96e0a309cb2cba3da59c63f3b521392461312201100008fba4d2fc95b.jpg)


I have outlined How our sampler is used to model clouds and how our lighting algorithm simulates the lighting effects associated with them. Now I am going to describe how and where we take samples to build an image. And how we integrate our clouds into atmosphere and our time of day cycle. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/5d93c55b1f6ed285dc1ae1b13dde4e69f02d5d06c4e9fa855012a3d5ce6a1787.jpg)


The first part of rendering with a ray march is deciding where to start. In our situation, Horizon takes place on Earth and as most of you are aware… the earth ….. Is round. 

• The gases that make up our atmosphere wrap around the earth and clouds exists in different layers of the atmosphere. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/b27287815892136c1a694b3c656562ddbb10d9d604d2abbca2161c054b43fb77.jpg)


When you are on a “flat” surface such as the ocean, you can clearly see how the curvature of the earth causes clouds to descend into the horizon. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/e1f971d541194bdef1838441c25c6abb8e5f30c1892f4b4743898f6c4c2d752d.jpg)


For the purposes of our game we divide the clouds into two types in this spherical atmosphere. 

• The low altitude volumetric strato class clouds between 1500 and 4000 meters… 

• and the high altitude 2D alto and cirro class clouds above 4000 meters. The upper level clouds are not very thick so this is a good area to reduce expense of the shader by making them scrolling textures instead of multiple samples in the ray march. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/ba8f57b044d8c8acdaa464f097cb27f165d2146876248b5390ff1abecf32011e.jpg)


By ray marching through spherical atmosphere we can… 

• ensure that clouds properly descend into the horizon. 

• It also means we can force the scale of the scene by shrinking the radius of the atmosphere. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/691d472c113cc1ca2c1853a7945c16efe5e3807342b521a544d6ce9e455f2e28.jpg)


In our situation we do not want to do any work or any expensive work where we don’t need to. So instead of sampling every point along the ray, we use our samplers two levels of detail as a way to do cheaper work until we actually hit a cloud. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/00c8d9dfb532f4b02653d64e89eb1b913fd7f27b7b5ab04a16e7510be1f0ae8d.jpg)


• Recall that the sampler has a low detail noise that make s basic cloud shape 

• and a high detail noise that adds the realistic detail we need. 

The high detail noise is always applied as an erosion from the edge of the base cloud shape. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/4edb1ac1106465da937f3dc13a4b4fddfca7d94c98f4b70bbd97f648d7908e7e.jpg)


This means that we only need to do the high detail noise and all of its associated instructions where the low detail sample returns a non zero result. 

• This has the effect of producing an isosurface that surrounds the area that our cloud will be that could be. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/0fa2271261f5d99944a44aa7d3c7dc6a4d3e9ef4f8793aff653206c9dc2d89da.jpg)


So, when we take samples through the atmosphere, we do these cheaper samples at a larger step size until we hit a cloud iso surface. Then we switch to full samples with the high detail noise and all of its associated instructions. To make sure that we do not miss any high res samples, we always take a step backward before switching to high detail samples. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/61463a8adaa1a1b1cbc12c1b03a114def10c7dfad6f01739124a2022e5c8edda.jpg)



• Once the alpha of the image reaches 1 we don’t need to keep sampling so we stop the march early.


![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/361d8756bc73681820f02fb6278a09404762864a19e96887b5135eb5c8c71812.jpg)


If we don’t reach an alpha of one we have another optimization. 

• After several consecutive samples that return zero density, we switch back to the cheap march behavior until we hit something again or reach the top of the cloud layer. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/0a08c4c167592dedc819d08a453b0c5ff7843c62024fd37aadb91bd7ec5b6456.jpg)


Because of the fact that the ray length increases as we look toward the horizon, we start with … 

• an initial potential 64 samples and end with a … 

• potential 128 at the horizon. I say potential because of the optimizations which can cause the march to exit early. And we really hope they do. 

This is how we take the samples to build up the alpha channel of our image. To calculate light intensity we need to take more samples. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/05d6033e85d6399a995c27141b39405b6a67e0f4236cd6aa7af321d631d60ef1.jpg)


Normally what you do in a ray march like this is to … 

• take samples toward the light source, plug the sum into your lighting equation and then attenuate this value using the alpha channel until you hopefully exit the march early because your alpha has reached 1. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/9d1b4250c4d9520ae3c114b2105572464024cceae3753b2aaa1f78f43d347f85.jpg)


In our approach, we sample 6 times in a cone toward the sun. This smooth's the banding we would normally get with 6 simples and weights our lighting function with neighboring density values, which creates a nice ambient effect. The last sample is placed far away from the rest … 

• in order to capture shadows cast by distant clouds. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/d3c1424c544d7f68ce1e8ad4919987bb2d7f3f063f8b514eb39e2f77aeb8a663.jpg)


Here you can see what our clouds look like with just alpha samples…. 

• With our 5 cone samples for lighting. 

• And the long distance cone sample. 

To improve performance of these light samples, we switched to sampling the cheap version of our shader once the alpha of the image reached 0.3. , this made the shader 2x faster 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/404c09135c7263b19fb44e3ab1b04997090d5d08bcbdf4d73835f97f5c5163ff.jpg)


The lighting samples replace the lower case d, or depth in the beers law portion of our lighting model. This energy value is then attenuated by the depth of the sample in the cloud to produce the image as per the standard volumetric ray-marching approach. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/d8e28e6a95716b8f8cdaa9a119e0b6191dbabd2e7f259b9ab0543533a2fed799.jpg)



The last step of our ray march was to…



• sample the 2d cloud textures for the high altitude clouds


![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/79503cd43acb5dc083ace4f5354e928ebb2a8450d583dc3be2d2a5bcd08de945.jpg)


These were a collection of the various types of cirrus and alto clouds that were tiling and scrolling at different speeds and directions above the volumetric clouds. 

## Rendering

Ambient color contribution increases with height 

Direct lighting color contribution comes from the sun 

Atmosphere occludes clouds over depth 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/e2567623a38a8029aaae735b1b9bd8bb92dce46e6171a086d62129fd4c5642e3.jpg)


## IN-GAME RENDER

In reality light rays of different frequencies are mixing in a cloud producing very beautiful color effects. Since we live in a world of approximations, we had to base cloud colors on some logical assumptions. 

We color our clouds based on the following model: 

• Ambient sky contribution increases over height 

• Direct lighting would be dominated by the sun color 

• Atmosphere would occlude clouds over depth. 

We add up our ambient and direct components and attenuate to the atmosphere color based on the depth channel. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/fb42927157de7b21dfa88e40909915a12b4703e4e89be718b6217ae517894bba.jpg)


Now, you can change the time of day in the game and the lighting and colors update automatically. This means no pre-baking and our unique memory usage for the entire sky is limited to the cost of 2 3d textures and 1 2d texture instead of dozens of billboards or sky domes. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/b2c42d124ab272b1b22b99f875b6ccc5d35ba0006c241478877afdffb0c5e63a.jpg)


## Rendering

Sampler does “cheap” work unless it is potentially in a cloud 

64-128 march samples, 6 light samples per march 

Light samples switch from full to cheap at a certain depth 

IN-GAME RENDER 

To sum up what makes our rendering approach unique: 

• Sampler does “cheap” work unless it is potentially in a cloud 

• 64-128 potential march samples, 6 light samples per march in a cone, when we are potentially in a cloud. 

• Light samples switch from full to cheap at a certain depth 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/3e8fb9258f804ccfd17cf627969f82b162e8f121465869aa126add881decabb2.jpg)



The approach that I have described so far costs around 20 milliseconds. (pause for laughter)


Which means it is pretty but, it is not fast enough to be included in our game. My codeveloper and mentor on this, Nathan Vos, Had the idea that… 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/9490b60609d3f554bdbbbdcdda208c503bfc7c7ce6c4faebdcc4d91e7ee5cb9f.jpg)


• to update 1 out of 16 pixels for each 4x4 pixel bl.ock within our final image. We reproject the previous frame to ensure we have something persistent. 

• Every frame we could use a quarter res buffer… …and where we could not reproject, like the edge of the screen, We substitute the result from one of the low res buffers. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/03583ac2f5c2e9f03d5c653eb9adf1666852186f01437f7e293b91d3104519f5.jpg)


Nathan’s idea made the shader 10x faster or more when we render this at half res and use filters to upscale it. 

It is pretty much the whole reason we are able to put this in our game. Because of this our target performance is around 2 milliseconds, most of that coming from the number of instructions. 

## Results

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/0a602c06d80e862a4c69520cb08b902aece63e1c279e58cbee71e8386268af46.jpg)


In review we feel that 

We have largely achieved our initial goals. This is still a work in progress as there is still time left in the production cycle so we hope to improve performance and directability a bit more. We’re also still working on our atmospheric model and weather system and we will be sharing more about this work in the future on our website and at future conferences. 

• All of this was captured on a playstation 4 

• And this solution was written in PSSL and C++ 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/24e449d15c5b7597f5cc4ad447c8050094af6a5cbfd5fef7a0dcc8826f6429f9.jpg)


ShaderToy.com 

CO-DEVELOPER Nathan Vos 

SPECIAL THANKS Elco Vossers Michal Valient Jan Bart van Beek Marijn Giesbertz Maarten van der Gaa Felix van den Bergh Vladimir Lopatin Hermen Hulst 

• A number of sources were utilized in the development of this system. I have listed them here. 

• I would like to thank My co-developer, Nathan vos most of all 

Also some other Guerrillas.. 

Elco – weather system and general help with transition to games 

Michal – supervising the shader development with me and Nathan 

Jan Bart, - for keeping us on target with our look goals 

Marijn – for allowing me the time in the fx budget to work on this and for his guidance 

Maarten van der Gaag for some optimization ideas 

Felix van den Bergh for slaving away at making polygon clouds and voxel clouds in the early days 

Vlad Lapotin, for his work testing out spherical harmonics 

And to Hermen Hulst, manager of Guerrilla for hiring me and for allowing us the resources and time to properly solve this problem for real-time. 

![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/ef409dc6cf9cb17cd4d07a92c12cbc7ca8ba1b1866e520a5609f7224196d1620.jpg)



Are there any questions?


![image](https://cdn-mineru.openxlab.org.cn/result/2026-10-19/f3554c63-bd60-48b3-b28c-20a9152846b4/c1e70bf20e2d5601344866653f0caa9c0e90ab96ea74fd5d1355e31a86e73546.jpg)



Peace out.
