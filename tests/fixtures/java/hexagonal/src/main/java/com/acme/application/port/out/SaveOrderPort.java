package com.acme.application.port.out;

import vision.noesis.annotations.Port;

@Port
public interface SaveOrderPort {
    void save();
}
