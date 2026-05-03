package com.example.controller;

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/posts")
public class PostController {

    @GetMapping
    public List<Object> listPosts() {
        return List.of();
    }

    @GetMapping("/{postId}")
    public Object getPost(@PathVariable Long postId) {
        return null;
    }

    @GetMapping({"/featured", "/pinned"})
    public List<Object> getFeaturedOrPinned() {
        return List.of();
    }
}
