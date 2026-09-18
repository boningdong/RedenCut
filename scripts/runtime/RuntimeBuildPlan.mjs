import { join } from 'node:path'

export function requireSupportedBuildTarget(platform, arch) {
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(
      `Full managed runtime build supports only darwin-arm64; ${platform}-${arch} has not been certified`,
    )
  }
}

export function createDarwinArm64BuildPlan(workDirectory) {
  const prefixRoot = join(workDirectory, 'prefix')
  const lamePrefix = join(prefixRoot, 'lame')
  const ffmpegPrefix = join(prefixRoot, 'ffmpeg')
  const whisperPrefix = join(prefixRoot, 'whisper')
  return {
    lame: {
      prefix: lamePrefix,
      configureArguments: [
        `--prefix=${lamePrefix}`,
        '--enable-shared',
        '--disable-static',
        '--disable-frontend',
        '--disable-decoder',
      ],
    },
    ffmpeg: {
      prefix: ffmpegPrefix,
      configureArguments: [
        `--prefix=${ffmpegPrefix}`,
        '--disable-static',
        '--enable-shared',
        '--disable-debug',
        '--disable-doc',
        '--disable-ffplay',
        '--disable-autodetect',
        '--enable-libmp3lame',
        '--disable-gpl',
        '--disable-nonfree',
        '--disable-version3',
        '--enable-pic',
        '--install-name-dir=@rpath',
        `--extra-cflags=-I${join(lamePrefix, 'include')}`,
        `--extra-ldflags=-L${join(lamePrefix, 'lib')} -Wl,-rpath,@executable_path/../lib`,
      ],
    },
    whisper: {
      prefix: whisperPrefix,
      buildDirectory: join(workDirectory, 'build', 'whisper'),
      cmakeArguments: [
        '-G',
        'Ninja',
        '-DCMAKE_BUILD_TYPE=Release',
        `-DCMAKE_INSTALL_PREFIX=${whisperPrefix}`,
        '-DBUILD_SHARED_LIBS=OFF',
        '-DWHISPER_BUILD_TESTS=OFF',
        '-DWHISPER_BUILD_EXAMPLES=ON',
        '-DGGML_METAL=ON',
        '-DGGML_METAL_EMBED_LIBRARY=ON',
        '-DGGML_ACCELERATE=ON',
        '-DGGML_NATIVE=OFF',
        '-DGGML_CPU_ARM_ARCH=armv8-a',
      ],
    },
  }
}
