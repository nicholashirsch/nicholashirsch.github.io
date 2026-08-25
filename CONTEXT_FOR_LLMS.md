# Project Overview

This is a website designed to act as my personal portfolio. I am a GNC engineering student applying for jobs/internships in the field. As such, the website is being designed with the target audience of other GNC engineers and recruiters.

The site is going to have a couple key features/elements:
- The theme is black (like space)
- Text will be terminal style (use Jetbrains Mono maybe?)
- On the home screen there will be a 3D rotating Earth with a starry skybox in the background
    - A satellite will be orbiting the Earth and the camera will follow it
    - Every day a different satellite will be chosen and propagated and then that will be the satellite displayed, a "satellite of the day if you will"
    - A Github action will be used to call propagation
- Projects live on their own page at `/projects.html`, reached from the banner and the home-screen nav: a list of
  my projects with photos and brief descriptions
    - That page shares the banner and the starry skybox, but deliberately drops the Earth and the typing
      animation -- it is meant to be read, not watched
- Contact details live on their own page at `/contact.html`: email, LinkedIn and GitHub as a
  row of linked boxes centred on the screen, over the same starfield and banner
- The site will be written predominantly in JavaScript and hosted on Github Pages
    - Node.js can be used if needed