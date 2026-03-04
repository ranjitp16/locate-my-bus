<!-- TABLE OF CONTENTS -->
<!-- <details open="open">
  <summary><h2 style="display: inline-block">Table of Contents</h2></summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgements">Acknowledgements</a></li>
  </ol>
</details> -->



<!-- ABOUT THE PROJECT -->
<!-- ## About The Project


Here's a blank template to get started:
**To avoid retyping too much info. Do a search and replace with your text editor for the following:**
`github_username`, `repo_name`, `twitter_handle`, `email`, `project_title`, `project_description`


### Built With

* []()
* []()
* []() -->



## Getting Started

For development this project uses the devcontainers so that the root is not polluted with a bunch of dependencies. So if you wish to use dev devContainers you can skip the Prerequisites section.

### Prerequisites

We need ```protoc``` to conver the .proto file into the dependencies which our program can than utilize
* macOs
  ```sh
  brew install protobuf
  ```

* linux
  ```sh
  sudo apt update && sudo apt install -y protobuf-compiler
  ```

* windows
  ```text
  Download the latest protoc-*-win64.zip from github.com/protocolbuffers/protobuf/releases, extract it, and add the bin folder to your PATH.
  ```

### Installation

1. Clone the repo and cd into it
   ```sh
   git clone git@github.com:ranjitp16/locate-my-bus.git && cd locate-my-bus
   ```
2. Open dev container or run 
  ```sh
  make get-protobuf-headers && make build"
  ```
3. Run the executable
  ```sh
  make run
  ```

and you're now running the program successfully


<!-- ## Usage

Use this space to show useful examples of how a project can be used. Additional screenshots, code examples and demos work well in this space. You may also link to more resources.

_For more examples, please refer to the [Documentation](https://example.com)_ -->



<!-- ## Roadmap

See the [open issues](https://github.com/github_username/repo_name/issues) for a list of proposed features (and known issues). -->


<!-- 
## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request -->



## License

Distributed under the MIT License. See `LICENSE` for more information.



## Contact

Ranjit Pandey - [@know_me](https://ranjitpandey.dev) - [contact@ranjitpandey.dev](mailto:contact@ranjitpandey.dev)

<!-- Project Link: [https://github.com/github_username/repo_name](https://github.com/github_username/repo_name) -->



<!-- ## Acknowledgements

* []()
* []() -->
## Read more about gtfs-rt
* [gtfs-rt](https://gtfs.org/documentation/realtime/proto/)
