package com.smartfin

import java.util.concurrent.CompletableFuture

/** Test-only state for a real recover() owner held after it acquired the cleanup mutex. */
object Phase5E4Hold {
  @Volatile var owner: CompletableFuture<String>? = null
}
