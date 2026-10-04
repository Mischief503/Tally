plugins {
    id("com.android.application")
}

// Each GitHub build gets a higher version number, so a new APK installs over the old one.
val run = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()

android {
    namespace = "com.tally.movers"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tally.movers"
        minSdk = 26
        targetSdk = 35
        versionCode = run
        versionName = "1.0.$run"
    }

    // One signing key for every build, so updates install over each other.
    // A test key ships in the repo; set the TALLY_KEYSTORE_* secrets to use your own.
    signingConfigs {
        create("tally") {
            storeFile = file(System.getenv("TALLY_KEYSTORE_FILE") ?: "tally-test.keystore")
            storePassword = System.getenv("TALLY_KEYSTORE_PASSWORD") ?: "tally-test"
            keyAlias = System.getenv("TALLY_KEY_ALIAS") ?: "tally"
            keyPassword = System.getenv("TALLY_KEY_PASSWORD") ?: "tally-test"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("tally")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("tally")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.core:core:1.13.1")
}
