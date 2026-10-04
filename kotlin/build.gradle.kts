plugins {
    kotlin("jvm") version "2.2.10"
    kotlin("plugin.serialization") version "2.2.10"
    `java-library`
}

group = "one.payrail"
version = "0.6.0"

dependencyLocking { lockAllConfigurations() }

java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
    withSourcesJar()
}

kotlin {
    explicitApi()
    compilerOptions { jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11 }
}

dependencies {
    api("org.jetbrains.kotlinx:kotlinx-serialization-json-jvm:1.9.0")
    implementation("org.bouncycastle:bcprov-jdk18on:1.85.2")
    testImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.13.4")
}

tasks.test { useJUnitPlatform() }
